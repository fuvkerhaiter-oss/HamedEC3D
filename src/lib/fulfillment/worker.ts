/**
 * Automatic fulfillment worker. For each claimed job (one per paid order):
 *   kill switch → verified payment (re-checked with the provider) → address → destination rules →
 *   supplier choice per line (live stock + price, backups by priority) → margin / purchase limits →
 *   kill switch again → idempotent supplier submission → supplier-payment follow-up.
 * Anything unsafe goes to the exception queue (job status manual_review) with the reasons, and the admin is notified.
 * Runs in the background (cron / after() of the payment webhook) — never inside the customer's checkout request.
 */
import { inTx, type Db } from "../db/client";
import { convertMinor } from "../fx";
import type { CurrencyCode } from "../money";
import { addressProblem } from "../shipping/address";
import { callSupplier, type RetryPolicy } from "../suppliers/call";
import { getSupplierAdapter } from "../suppliers/adapters";
import type { SplitResult, SupplierGroup } from "../suppliers/split";
import { SupplierError, supports, type SupplierAdapter } from "../suppliers/types";
import { notify } from "../admin/services/notifications";
import { hasOpenWithdrawal } from "../orders/withdrawal";
import { rateToBase, requireFulfillmentEligible, OrderError, type ShipTo } from "../admin/services/orders";
import { createSupplierOrders, type FulfillmentDeps } from "../admin/services/suppliers";
import { claimDueJobs, deferJob, finishJob, loadAutomationSettings, logAutomation, scheduleRetry, type FulfillmentJob } from "./jobs";
import { addressProblems, allocateRevenue, checkCandidate, checkPurchase, countryAllowed, retryDelayMs } from "./rules";

export interface WorkerDeps extends FulfillmentDeps {
  retry?: RetryPolicy;
  sleep?: (ms: number) => Promise<void>;
}

/** Thrown for transient problems (supplier API down/timeouts during checks): the job is retried with backoff. */
class TransientError extends Error {}

type Outcome =
  | { kind: "succeeded"; stage: string; message: string }
  | { kind: "review"; stage: string; reasons: string[] }
  | { kind: "retry"; stage: string; error: string }
  | { kind: "deferred" }
  | { kind: "cancelled"; stage: string; message: string };

export async function processDueFulfillmentJobs(db: Db, opts: { limit?: number } & WorkerDeps = {}): Promise<{ processed: number; results: { orderId: string; outcome: string }[] }> {
  const jobs = await claimDueJobs(db, opts.limit ?? 5);
  const results: { orderId: string; outcome: string }[] = [];
  for (const job of jobs) results.push({ orderId: job.order_id, outcome: await runJob(db, job, opts) });
  return { processed: jobs.length, results };
}

export async function runJob(db: Db, job: FulfillmentJob, deps: WorkerDeps = {}): Promise<string> {
  let outcome: Outcome;
  try {
    outcome = await fulfil(db, job, deps);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    outcome = e instanceof TransientError || (e instanceof SupplierError && e.retryable)
      ? { kind: "retry", stage: "error", error: msg }
      : e instanceof OrderError
        ? { kind: "review", stage: "error", reasons: [msg] }
        : { kind: "retry", stage: "error", error: `Unexpected error: ${msg}` };
  }
  const [o] = await db<{ order_number: number }[]>`select order_number from public.orders where id = ${job.order_id}`;
  const n = o?.order_number ?? "?";
  switch (outcome.kind) {
    case "deferred":
      return "deferred";
    case "succeeded":
      await finishJob(db, job.id, { status: "succeeded", stage: outcome.stage });
      await logAutomation(db, { orderId: job.order_id, jobId: job.id, event: "job.succeeded", message: outcome.message });
      return "succeeded";
    case "cancelled":
      await finishJob(db, job.id, { status: "cancelled", stage: outcome.stage, reviewReason: outcome.message });
      await logAutomation(db, { orderId: job.order_id, jobId: job.id, event: "job.cancelled", message: outcome.message });
      return "cancelled";
    case "review": {
      const reason = outcome.reasons.join("; ").slice(0, 1000);
      await finishJob(db, job.id, { status: "manual_review", stage: outcome.stage, reviewReason: reason });
      await logAutomation(db, { orderId: job.order_id, jobId: job.id, level: "warn", event: "job.manual_review", message: reason, data: { stage: outcome.stage } });
      await notify(db, { kind: "fulfillment_review", severity: "warning", title: `Order #${n} needs a manual fulfillment decision`, body: reason.slice(0, 500), link: "/admin/dropshipping", dedupeKey: `fulfil-review:${job.order_id}:${job.attempts}` });
      return "manual_review";
    }
    case "retry": {
      if (job.attempts >= job.max_attempts) {
        await finishJob(db, job.id, { status: "failed", stage: outcome.stage, lastError: outcome.error, reviewReason: `Gave up after ${job.attempts} attempts: ${outcome.error}` });
        await logAutomation(db, { orderId: job.order_id, jobId: job.id, level: "error", event: "job.dead_letter", message: outcome.error });
        await notify(db, { kind: "fulfillment_failed", severity: "critical", title: `Automatic fulfillment failed for order #${n}`, body: outcome.error.slice(0, 500), link: "/admin/dropshipping", dedupeKey: `fulfil-failed:${job.order_id}` });
        return "failed";
      }
      const delay = retryDelayMs(job.attempts);
      await scheduleRetry(db, job.id, delay, outcome.stage, outcome.error);
      await logAutomation(db, { orderId: job.order_id, jobId: job.id, level: "warn", event: "job.retry", message: `${outcome.error} — retry ${job.attempts + 1}/${job.max_attempts} in ${Math.round(delay / 60000)} min` });
      return "retry";
    }
  }
}

interface Candidate {
  mappingId: string;
  supplierId: string;
  supplierName: string;
  adapterKey: string;
  mode: "manual" | "api";
  supplierActive: boolean;
  supportedCountries: string[];
  supplierSku: string;
  supplierProductId: string | null;
  supplierVariantId: string | null;
  shippingMethod: string | null;
  shippingCost: number | null;
  cost: number;
  currency: CurrencyCode;
  autoFulfill: boolean;
  isPrimary: boolean;
  priority: number;
  variant_id: string;
}

async function fulfil(db: Db, job: FulfillmentJob, deps: WorkerDeps): Promise<Outcome> {
  const log = (event: string, message: string, data?: unknown, level: "info" | "warn" | "error" = "info") =>
    logAutomation(db, { orderId: job.order_id, jobId: job.id, event, message, data, level });

  // 1. Switches.
  const { sw, rules } = await loadAutomationSettings(db);
  if (sw.killSwitch) {
    await deferJob(db, job.id, 15, "kill_switch");
    await log("job.deferred", "Kill switch is on — nothing sent to suppliers; job waits", undefined, "warn");
    return { kind: "deferred" };
  }
  if (!sw.enabled) return { kind: "review", stage: "automation_off", reasons: ["Automatic purchasing is turned off — fulfil this order manually, or turn automation on and retry"] };

  // 2. Order state + verified payment (re-verified with the payment provider, under the order lock).
  const [order] = await db<{ status: string; order_number: number; currency: CurrencyCode; total: number; tax_total: number; subtotal: number; shipping_address: ShipTo; ship_country: string }[]>`
    select status, order_number, currency, total, tax_total, subtotal, shipping_address, ship_country from public.orders where id = ${job.order_id}`;
  if (!order) return { kind: "cancelled", stage: "load", message: "Order not found" };
  if (["cancelled", "refunded", "refund_requested", "pending_payment"].includes(order.status)) {
    return { kind: "cancelled", stage: "load", message: `Order is ${order.status} — nothing to fulfil` };
  }
  if (["submitted_to_supplier", "supplier_accepted", "shipped", "delivered"].includes(order.status)) {
    return { kind: "succeeded", stage: "already_fulfilled", message: `Order already ${order.status}` };
  }
  if (await hasOpenWithdrawal(db, job.order_id)) {
    return { kind: "review", stage: "customer_withdrawal", reasons: ["The customer withdrew from this order (all or part) — cancel/refund the withdrawn items, then buy only what is still wanted"] };
  }
  await inTx(db, (tx) => requireFulfillmentEligible(tx, job.order_id, deps.getProvider));
  await log("check.payment", "Payment verified with the provider");

  // 3. Previous attempts: never re-plan lines that may already be with a supplier.
  const existing = await db<{ supplier_id: string; status: string; last_error: string | null }[]>`
    select supplier_id, status::text, last_error from public.supplier_orders where order_id = ${job.order_id}`;
  const unsure = existing.filter((e) => e.status === "submitting" || e.status === "manual_required");
  if (unsure.length) {
    return { kind: "review", stage: "previous_attempt", reasons: unsure.map((u) => `A supplier order is ${u.status.replace("_", " ")}${u.last_error ? `: ${u.last_error}` : ""} — confirm with the supplier before anything is resubmitted`) };
  }
  const lockedSupplier = new Map<string, string>(); // orderItemId → supplier of an earlier failed attempt
  if (existing.length) {
    const rows = await db<{ order_item_id: string; supplier_id: string }[]>`
      select i.order_item_id, so.supplier_id from public.supplier_order_items i join public.supplier_orders so on so.id = i.supplier_order_id where so.order_id = ${job.order_id}`;
    for (const r of rows) lockedSupplier.set(r.order_item_id, r.supplier_id);
  }

  // 4. Address + destination.
  const a = order.shipping_address;
  const country = (a.country ?? order.ship_country).toUpperCase();
  if (!countryAllowed(country, rules)) return { kind: "review", stage: "validate_address", reasons: [`Automatic purchasing is not enabled for ${country}`] };

  // 5. Candidates per line.
  const items = await db<{ id: string; variant_id: string | null; sku: string; quantity: number; line_total: number; product_name: string }[]>`
    select id, variant_id, sku, quantity, line_total, product_name from public.order_items where order_id = ${job.order_id} order by id`;
  const cands = await db<Candidate[]>`
    select sp.id as "mappingId", sp.supplier_id as "supplierId", s.name as "supplierName", s.adapter_key as "adapterKey", s.fulfillment_mode as mode,
           s.is_active as "supplierActive", s.supported_countries as "supportedCountries", sp.supplier_sku as "supplierSku",
           sp.supplier_product_id as "supplierProductId", sp.supplier_variant_id as "supplierVariantId", sp.shipping_method as "shippingMethod",
           sp.shipping_cost_amount as "shippingCost", sp.cost_amount as cost, sp.cost_currency::text as currency, sp.auto_fulfill as "autoFulfill",
           sp.is_primary as "isPrimary", sp.priority, sp.variant_id
      from public.supplier_products sp join public.suppliers s on s.id = sp.supplier_id
     where sp.variant_id = any(${items.map((i) => i.variant_id).filter(Boolean) as string[]}::uuid[])
     order by sp.is_primary desc, sp.priority asc, sp.id`;

  const adapters = new Map<string, SupplierAdapter | null | Error>();
  const adapterOf = (c: Candidate): SupplierAdapter | null | Error => {
    if (!adapters.has(c.supplierId)) {
      try {
        adapters.set(c.supplierId, c.mode === "api" ? (deps.getAdapter ?? getSupplierAdapter)(c.adapterKey, c.supplierId) : null);
      } catch (e) {
        adapters.set(c.supplierId, e as Error);
      }
    }
    return adapters.get(c.supplierId)!;
  };
  const policy = deps.retry;

  const phoneRequired = cands.some((c) => c.mode === "api" && c.adapterKey === "aliexpress");
  const addrProblems = addressProblems(a, addressProblem({ country, region: a.region, postalCode: a.postalCode ?? "" }), { phoneRequired });
  if (addrProblems.length) return { kind: "review", stage: "validate_address", reasons: addrProblems.map((p) => `Address: ${p}`) };
  await log("check.address", `Address valid for ${country}`);

  type Chosen = { item: (typeof items)[number]; c: Candidate; unitCost: number };
  const chosen: Chosen[] = [];
  const reasons: string[] = [];
  for (const item of items) {
    const forLine = cands.filter((c) => c.variant_id === item.variant_id)
      .filter((c) => !lockedSupplier.has(item.id) || lockedSupplier.get(item.id) === c.supplierId);
    if (!forLine.length) {
      reasons.push(`${item.product_name} (${item.sku}): no supplier mapped`);
      continue;
    }
    const tryList = rules.useBackupSuppliers ? forLine : forLine.slice(0, 1);
    const lineProblems: string[] = [];
    let pick: Chosen | null = null;
    for (const c of tryList) {
      const adapter = adapterOf(c);
      if (adapter instanceof Error) {
        lineProblems.push(`${c.supplierName}: ${adapter.message}`);
        continue;
      }
      let liveCost: number | null = null;
      let liveAvail: number | null = null;
      if (adapter) {
        const key = c.supplierProductId ? (c.supplierVariantId ? `${c.supplierProductId}|${c.supplierVariantId}` : c.supplierProductId) : c.supplierSku;
        try {
          if (supports(adapter, "availability") && adapter.getAvailability) {
            const [s] = await callSupplier((sig) => adapter.getAvailability!([key], sig), policy, deps.sleep);
            liveAvail = s?.available ?? 0;
          }
          if (supports(adapter, "pricing") && adapter.getPricing) {
            const [p] = await callSupplier((sig) => adapter.getPricing!([key], sig), policy, deps.sleep);
            if (!p) lineProblems.push(`${c.supplierName}: no live price for ${key}`);
            else if (p.cost.currency !== c.currency) liveCost = await convertOrNull(db, p.cost.amount, p.cost.currency, c.currency);
            else liveCost = p.cost.amount;
          }
        } catch (e) {
          const se = e instanceof SupplierError ? e : new SupplierError(String(e), "unknown");
          if (se.retryable) throw new TransientError(`${c.supplierName} did not answer the stock/price check: ${se.message}`);
          lineProblems.push(`${c.supplierName}: ${se.message}`);
          continue;
        }
        await db`update public.supplier_products set last_live_cost = ${liveCost}, last_live_available = ${liveAvail}, last_synced_at = now() where id = ${c.mappingId}`;
      }
      const problems = checkCandidate({
        quantity: item.quantity, expectedUnitCost: c.cost, liveUnitCost: liveCost, liveAvailable: liveAvail, autoFulfill: c.autoFulfill,
        supplierActive: c.supplierActive, supplierCountries: c.supportedCountries ?? [], shipCountry: country, shippingMethod: c.shippingMethod,
        requiresShippingMethod: !!adapter && c.adapterKey === "aliexpress",
      }, rules);
      if (problems.length) {
        lineProblems.push(`${c.supplierName}: ${problems.join(", ")}`);
        continue;
      }
      pick = { item, c, unitCost: liveCost ?? c.cost };
      break;
    }
    if (pick) {
      chosen.push(pick);
      await log("check.supplier", `${item.sku} → ${pick.c.supplierName}${pick.c.isPrimary ? "" : " (backup)"}`, { unitCost: pick.unitCost, currency: pick.c.currency });
    } else reasons.push(`${item.product_name} (${item.sku}): ${lineProblems.join(" | ")}`);
  }
  if (reasons.length) return { kind: "review", stage: "check_suppliers", reasons };

  // 6. Money checks per supplier purchase.
  const [pay] = await db<{ fee_amount: number | null; currency: string }[]>`
    select fee_amount, currency::text from public.payments where order_id = ${job.order_id} and status in ('succeeded','partially_refunded') order by updated_at desc limit 1`;
  const groups = new Map<string, Chosen[]>();
  for (const ch of chosen) groups.set(ch.c.supplierId, [...(groups.get(ch.c.supplierId) ?? []), ch]);
  const plan: SplitResult = { groups: [], unassigned: [] };
  for (const [supplierId, lines] of groups) {
    const linesTotal = lines.reduce((s, l) => s + Number(l.item.line_total), 0);
    const revenue = allocateRevenue({ total: Number(order.total), taxTotal: Number(order.tax_total), subtotal: Number(order.subtotal) }, linesTotal);
    let costOrder: number | null = 0;
    let costLimit: number | null = 0;
    for (const l of lines) {
      const lineCost = l.unitCost * l.item.quantity + (l.c.shippingCost ?? 0);
      const inOrder = await convertOrNull(db, lineCost, l.c.currency, order.currency);
      const inLimit = await convertOrNull(db, lineCost, l.c.currency, rules.maxPurchaseCurrency);
      costOrder = costOrder === null || inOrder === null ? null : costOrder + inOrder;
      costLimit = costLimit === null || inLimit === null ? null : costLimit + inLimit;
    }
    const fee = pay?.fee_amount != null && pay.currency === order.currency && Number(order.subtotal) > 0 ? Math.ceil((Number(pay.fee_amount) * linesTotal) / Number(order.subtotal)) : null;
    const check = checkPurchase({ revenue, costInOrderCurrency: costOrder, costInLimitCurrency: costLimit, paymentFee: fee }, rules);
    const name = lines[0]!.c.supplierName;
    await log("check.margin", `${name}: revenue ${revenue}, cost ${costOrder ?? "?"} ${order.currency}, margin ${check.marginBps === null ? "n/a" : check.marginBps / 100 + "%"}`, { revenue, costOrder, costLimit, fee, marginBps: check.marginBps });
    if (!check.ok) reasons.push(`${name}: ${check.problems.join(", ")}`);
    const currencies = new Set(lines.map((l) => l.c.currency));
    const g: SupplierGroup = {
      supplierId,
      lines: lines.map((l) => ({ orderItemId: l.item.id, supplierSku: l.c.supplierSku, quantity: l.item.quantity, unitCost: l.unitCost, costCurrency: l.c.currency, supplierProductId: l.c.supplierProductId, supplierVariantId: l.c.supplierVariantId, shippingMethod: l.c.shippingMethod })),
      costTotal: currencies.size === 1 ? { amount: lines.reduce((s, l) => s + l.unitCost * l.item.quantity + (l.c.shippingCost ?? 0), 0), currency: lines[0]!.c.currency } : null,
    };
    plan.groups.push(g);
  }
  if (reasons.length) return { kind: "review", stage: "check_margin", reasons };

  // 7. Last look at the kill switch, then submit (idempotent per order+supplier).
  if ((await loadAutomationSettings(db)).sw.killSwitch) {
    await deferJob(db, job.id, 15, "kill_switch");
    await log("job.deferred", "Kill switch turned on during checks — nothing submitted", undefined, "warn");
    return { kind: "deferred" };
  }
  if (await hasOpenWithdrawal(db, job.order_id)) {
    return { kind: "review", stage: "customer_withdrawal", reasons: ["The customer withdrew while the order was being checked — nothing was sent to the supplier"] };
  }
  await log("submit.start", `Submitting to ${plan.groups.length} supplier(s)`);
  const res = await createSupplierOrders(db, null, job.order_id, { plan, retryFailed: true, getProvider: deps.getProvider, getAdapter: deps.getAdapter });
  for (const r of res.results) await log("submit.result", `${r.supplierId}: ${r.outcome}`, r, r.outcome.startsWith("failed") ? "warn" : "info");

  const retryable = res.results.filter((r) => r.outcome === "failed_retryable" || r.outcome === "in_progress");
  const manual = res.results.filter((r) => !["submitted", "failed_retryable", "in_progress"].includes(r.outcome));
  if (manual.length) {
    const rows = await db<{ name: string; status: string; last_error: string | null }[]>`
      select s.name, so.status::text, so.last_error from public.supplier_orders so join public.suppliers s on s.id = so.supplier_id
       where so.order_id = ${job.order_id} and so.status in ('manual_required','failed')`;
    return { kind: "review", stage: "submit", reasons: rows.map((r) => r.status === "manual_required" && !r.last_error ? `${r.name} is a manual supplier — place the order with them and record their order number` : `${r.name}: ${r.last_error ?? r.status}`) };
  }
  if (retryable.length) return { kind: "retry", stage: "submit", error: `Supplier submission did not complete (${retryable.map((r) => r.outcome).join(", ")})` };

  const pending = await db<{ supplier_order_ref: string; name: string }[]>`
    select so.supplier_order_ref, s.name from public.supplier_orders so join public.suppliers s on s.id = so.supplier_id
     where so.order_id = ${job.order_id} and so.supplier_payment_status = 'pending'`;
  if (pending.length) {
    await notify(db, {
      kind: "supplier_payment", severity: "warning", title: `Pay the supplier for order #${order.order_number}`,
      body: pending.map((p) => `${p.name} order ${p.supplier_order_ref}`).join(", ") + " — created unpaid. Pay it in your supplier account; the sync will detect it.",
      link: "/admin/dropshipping", dedupeKey: `supplier-pay:${job.order_id}`,
    });
  }
  return { kind: "succeeded", stage: pending.length ? "awaiting_supplier_payment" : "submitted", message: `Supplier order(s) created${pending.length ? "; supplier payment pending" : ""}` };
}

async function convertOrNull(db: Db, amount: number, from: CurrencyCode, to: CurrencyCode): Promise<number | null> {
  if (from === to) return amount;
  const rate = await rateToBase(db, from, to);
  return rate ? convertMinor(amount, from, to, rate) : null;
}

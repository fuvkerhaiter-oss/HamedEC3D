/**
 * Online withdrawal function (EU Consumer Rights Directive art. 11a, from 19 June 2026; Italian Consumer Code
 * arts. 52–59). A consumer can withdraw from all or part of an EU order with a "withdraw from contract" form
 * and a "Confirm withdrawal" button; we store the statement as evidence, email an acknowledgement (durable
 * medium) with its content and date/time, pause supplier purchasing and alert the team.
 *
 * Withdrawal does NOT change the order status or refund by itself: the team checks it and refunds with the
 * existing refund flow (order status only via transitionOrder). The 14-day period is computed generously.
 */
import type { Db, Tx } from "../db/client";
import { inTx } from "../db/client";
import { orderUrl } from "../checkout/order-link";
import { getEmailProvider } from "../email/provider";
import { publicSiteUrl } from "../email/outbox";
import type { CurrencyCode } from "../money";
import type { OrderStatus } from "./state-machine";
import { notify } from "../admin/services/notifications";
import { logActivity, type Actor } from "../admin/audit";

export const WITHDRAWAL_DAYS = 14;
/** Extra hours after the end of the last day (UTC) so every European time zone gets its full last day. */
const GRACE_HOURS = 12;

/** Orders that were paid and are not already being cancelled/refunded. */
const OPEN_STATUSES: OrderStatus[] = ["paid", "processing", "submitted_to_supplier", "supplier_accepted", "shipped", "delivered"];

export type WithdrawalBlock = "not_eu" | "not_paid" | "closed" | "expired" | "nothing_left";

export interface WindowInput {
  currency: CurrencyCode;
  status: OrderStatus;
  /** When the LAST parcel was delivered; null while not (fully) delivered. */
  deliveredAt: Date | null;
}

/**
 * Is the withdrawal period open? It ends 14 days after the day the consumer receives the (last) goods, so it is
 * always open before delivery. Deadline = end of delivery day + 14 days (UTC) + a grace period.
 */
export function withdrawalWindow(w: WindowInput, now = new Date()): { open: boolean; block?: WithdrawalBlock; deadline: Date | null } {
  if (w.currency !== "EUR") return { open: false, block: "not_eu", deadline: null };
  if (w.status === "pending_payment" || w.status === "failed") return { open: false, block: "not_paid", deadline: null };
  if (!OPEN_STATUSES.includes(w.status)) return { open: false, block: "closed", deadline: null };
  if (w.status !== "delivered" || !w.deliveredAt) return { open: true, deadline: null };
  const d = w.deliveredAt;
  const deadline = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + WITHDRAWAL_DAYS + 1) + GRACE_HOURS * 3600_000);
  return now.getTime() < deadline.getTime() ? { open: true, deadline } : { open: false, block: "expired", deadline };
}

export interface WithdrawableItem {
  id: string;
  name: string;
  variant: string;
  quantity: number;
  /** Already covered by earlier (not rejected) withdrawals. */
  withdrawn: number;
}

export class WithdrawalError extends Error {}

/** Validates the requested lines against what is still withdrawable. Pure. */
export function planWithdrawal(items: WithdrawableItem[], requested: { orderItemId: string; quantity: number }[]): { lines: { orderItemId: string; quantity: number }[]; wholeOrder: boolean } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const merged = new Map<string, number>();
  for (const r of requested) {
    if (!Number.isInteger(r.quantity) || r.quantity < 0) throw new WithdrawalError("Invalid quantity.");
    if (!byId.has(r.orderItemId)) throw new WithdrawalError("An item does not belong to this order.");
    merged.set(r.orderItemId, (merged.get(r.orderItemId) ?? 0) + r.quantity);
  }
  const lines: { orderItemId: string; quantity: number }[] = [];
  for (const [id, qty] of merged) {
    if (qty === 0) continue;
    const it = byId.get(id)!;
    const left = it.quantity - it.withdrawn;
    if (qty > left) throw new WithdrawalError(left === 0 ? `You have already withdrawn from "${it.name}".` : `You can withdraw at most ${left} × "${it.name}".`);
    lines.push({ orderItemId: id, quantity: qty });
  }
  if (!lines.length) throw new WithdrawalError("Choose at least one item to withdraw from.");
  const wholeOrder = items.every((i) => (merged.get(i.id) ?? 0) === i.quantity - i.withdrawn) && items.every((i) => i.withdrawn === 0);
  return { lines, wholeOrder };
}

export interface WithdrawalRecord {
  id: string;
  status: "received" | "completed" | "rejected";
  submittedAt: string;
  fullName: string;
  confirmationEmail: string;
  reason: string | null;
  wholeOrder: boolean;
  adminNote: string | null;
  handledAt: string | null;
  items: { name: string; variant: string; quantity: number }[];
}

export interface WithdrawalContext {
  orderId: string;
  orderNumber: number;
  email: string;
  fullName: string;
  status: OrderStatus;
  currency: CurrencyCode;
  window: ReturnType<typeof withdrawalWindow>;
  items: WithdrawableItem[];
  requests: WithdrawalRecord[];
  /** Why the form cannot be used now, if it cannot. */
  block: WithdrawalBlock | null;
}

export async function loadWithdrawalContext(db: Db, orderId: string, now = new Date()): Promise<WithdrawalContext | null> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const [o] = await db<{ id: string; order_number: string; email: string; status: OrderStatus; currency: CurrencyCode; shipping_address: { fullName?: string } }[]>`
    select id, order_number, email, status, currency, shipping_address from public.orders where id = ${orderId}`;
  if (!o) return null;
  const [del] = await db<{ at: Date | null }[]>`
    select coalesce(
      (select max(delivered_at) from public.shipments where order_id = ${orderId}),
      (select max(created_at) from public.order_status_events where order_id = ${orderId} and to_status = 'delivered')) as at`;
  const items = await db<{ id: string; product_name: string; variant_name: string; quantity: number; withdrawn: number }[]>`
    select i.id, i.product_name, i.variant_name, i.quantity,
           coalesce((select sum(wi.quantity) from public.withdrawal_request_items wi join public.withdrawal_requests w on w.id = wi.request_id
                      where wi.order_item_id = i.id and w.status <> 'rejected'), 0)::int as withdrawn
      from public.order_items i where i.order_id = ${orderId} order by i.product_name, i.id`;
  const requests = await listWithdrawals(db, orderId);
  const window = withdrawalWindow({ currency: o.currency, status: o.status, deliveredAt: del?.at ? new Date(del.at) : null }, now);
  const list: WithdrawableItem[] = items.map((i) => ({ id: i.id, name: i.product_name, variant: i.variant_name, quantity: i.quantity, withdrawn: Number(i.withdrawn) }));
  const nothingLeft = list.every((i) => i.withdrawn >= i.quantity);
  return {
    orderId: o.id, orderNumber: Number(o.order_number), email: o.email, fullName: o.shipping_address?.fullName ?? "",
    status: o.status, currency: o.currency, window, items: list, requests,
    block: window.block ?? (nothingLeft ? "nothing_left" : null),
  };
}

export async function listWithdrawals(db: Db, orderId: string): Promise<WithdrawalRecord[]> {
  const rows = await db<{ id: string; status: WithdrawalRecord["status"]; submitted_at: Date; full_name: string; confirmation_email: string; reason: string | null; whole_order: boolean; admin_note: string | null; handled_at: Date | null }[]>`
    select id, status, submitted_at, full_name, confirmation_email, reason, whole_order, admin_note, handled_at
      from public.withdrawal_requests where order_id = ${orderId} order by submitted_at desc`;
  if (!rows.length) return [];
  const lines = await db<{ request_id: string; product_name: string; variant_name: string; quantity: number }[]>`
    select wi.request_id, i.product_name, i.variant_name, wi.quantity
      from public.withdrawal_request_items wi join public.order_items i on i.id = wi.order_item_id
     where wi.request_id = any(${rows.map((r) => r.id)}::uuid[]) order by i.product_name`;
  return rows.map((r) => ({
    id: r.id, status: r.status, submittedAt: new Date(r.submitted_at).toISOString(), fullName: r.full_name, confirmationEmail: r.confirmation_email,
    reason: r.reason, wholeOrder: r.whole_order, adminNote: r.admin_note, handledAt: r.handled_at ? new Date(r.handled_at).toISOString() : null,
    items: lines.filter((l) => l.request_id === r.id).map((l) => ({ name: l.product_name, variant: l.variant_name, quantity: l.quantity })),
  }));
}

export interface SubmitWithdrawalInput {
  orderId: string;
  fullName: string;
  confirmationEmail: string;
  reason: string | null;
  items: { orderItemId: string; quantity: number }[];
}

const fmtWhen = (d: Date) => `${d.toLocaleString("en-GB", { timeZone: "Europe/Rome", dateStyle: "long", timeStyle: "short" })} (Italian time)`;

/** Acknowledgement of receipt on a durable medium: content of the statement + date and time of receipt. */
export function withdrawalAckEmail(p: { orderNumber: number; fullName: string; submittedAt: Date; items: { name: string; variant: string; quantity: number }[]; wholeOrder: boolean; orderLink: string; returnsLink: string }): { subject: string; text: string } {
  const first = p.fullName.split(" ")[0] || "there";
  const items = p.items.map((i) => `  ${i.quantity} × ${i.name}${i.variant && i.variant !== "Default" ? ` (${i.variant})` : ""}`).join("\n");
  return {
    subject: `We received your withdrawal for order #${p.orderNumber}`,
    text: `Hello ${first},

This email confirms that we received your statement of withdrawal.

Order: #${p.orderNumber}
Received on: ${fmtWhen(p.submittedAt)}
Name: ${p.fullName}
You withdrew from ${p.wholeOrder ? "the whole order" : "these items"}:
${items}

What happens next
• If you have not received the goods yet, we will try to stop the shipment. If it has already left, you can refuse the parcel or return it once it arrives.
• If you already have the goods, please wait for our email with the return address and instructions (within 2 business days). Do not send anything to the sender address printed on the parcel: it may be a supplier's warehouse that does not accept returns.
• Send the goods back within 14 days of today.
• We refund all payments for the withdrawn items, including standard delivery costs where the law requires it, within 14 days of today, using your original payment method. We may wait until we receive the goods or proof that you sent them.

Your order: ${p.orderLink}
Returns policy: ${p.returnsLink}

Keep this email: it is your proof of withdrawal. Questions? Just reply with your order number #${p.orderNumber}.

WEGO SHIIIP · Happy Family, Happy Animals`,
  };
}

/** Stores the statement, emails the acknowledgement, pauses automatic supplier purchasing and alerts the team. */
export async function submitWithdrawal(db: Db, input: SubmitWithdrawalInput, now = new Date()): Promise<{ requestId: string; submittedAt: string; wholeOrder: boolean }> {
  return inTx(db, async (tx: Tx) => {
    // Lock the order so two quick submissions cannot withdraw the same items twice.
    const [locked] = await tx`select id from public.orders where id = ${input.orderId} for update`;
    if (!locked) throw new WithdrawalError("Order not found.");
    const ctx = await loadWithdrawalContext(tx, input.orderId, now);
    if (!ctx) throw new WithdrawalError("Order not found.");
    if (ctx.block) throw new WithdrawalError(blockMessage(ctx.block));
    const plan = planWithdrawal(ctx.items, input.items);

    const [req] = await tx<{ id: string; submitted_at: Date }[]>`
      insert into public.withdrawal_requests (order_id, full_name, confirmation_email, reason, whole_order, submitted_at)
      values (${input.orderId}, ${input.fullName}, ${input.confirmationEmail}, ${input.reason}, ${plan.wholeOrder}, ${now})
      returning id, submitted_at`;
    for (const l of plan.lines) {
      await tx`insert into public.withdrawal_request_items (request_id, order_item_id, quantity) values (${req!.id}, ${l.orderItemId}, ${l.quantity})`;
    }

    const byId = new Map(ctx.items.map((i) => [i.id, i]));
    const lineInfo = plan.lines.map((l) => ({ name: byId.get(l.orderItemId)!.name, variant: byId.get(l.orderItemId)!.variant, quantity: l.quantity }));
    const site = publicSiteUrl();
    const mail = withdrawalAckEmail({
      orderNumber: ctx.orderNumber, fullName: input.fullName, submittedAt: new Date(req!.submitted_at), items: lineInfo, wholeOrder: plan.wholeOrder,
      orderLink: orderUrl(site, input.orderId), returnsLink: `${site}/pages/returns`,
    });
    const recipients = [...new Set([input.confirmationEmail.toLowerCase(), ctx.email.toLowerCase()])];
    for (const to of recipients) {
      await tx`insert into public.email_outbox (to_address, subject, body_text, template, status, related_order_id, dedupe_key)
               values (${to}, ${mail.subject}, ${mail.text}, 'withdrawal_received', ${getEmailProvider() ? "queued" : "not_configured"}, ${input.orderId}, ${`withdrawal:${req!.id}:${to}`})
               on conflict (dedupe_key) where dedupe_key is not null do nothing`;
    }

    // Pause automatic purchasing for this order (the worker also re-checks before buying).
    const reason = `Customer withdrew from ${plan.wholeOrder ? "the whole order" : "part of the order"} — decide before buying from the supplier`;
    const held = await tx<{ id: string }[]>`update public.fulfillment_jobs set status = 'manual_review', stage = 'customer_withdrawal', review_reason = ${reason}, locked_until = null
                        where order_id = ${input.orderId} and status = 'queued' returning id`;
    if (held.length) await tx`insert into public.automation_logs (order_id, job_id, level, event, message) values (${input.orderId}, ${held[0]!.id}, 'warn', 'job.held', ${reason})`;

    const supplierNote = ["submitted_to_supplier", "supplier_accepted", "shipped", "delivered"].includes(ctx.status)
      ? " The order is already with the supplier or shipped: send the customer return instructions." : " Not yet sent to a supplier: cancel those items before buying them.";
    await notify(tx, {
      kind: "withdrawal_received", severity: "warning",
      title: `Withdrawal from order #${ctx.orderNumber}`,
      body: `${input.fullName} withdrew from ${plan.wholeOrder ? "the whole order" : lineInfo.map((l) => `${l.quantity} × ${l.name}`).join(", ")}. Answer within 2 business days; refund within 14 days.${supplierNote}`,
      link: `/admin/orders/${input.orderId}`, dedupeKey: `withdrawal:${req!.id}`,
    });
    return { requestId: req!.id, submittedAt: new Date(req!.submitted_at).toISOString(), wholeOrder: plan.wholeOrder };
  });
}

/** True while a withdrawal for this order is waiting for the team (fulfillment must not buy blindly). */
export async function hasOpenWithdrawal(db: Db, orderId: string): Promise<boolean> {
  const [r] = await db`select 1 from public.withdrawal_requests where order_id = ${orderId} and status = 'received' limit 1`;
  return !!r;
}

/** Admin: mark a withdrawal completed (goods back / refunded) or rejected (with a note). Refunds go through the refund flow. */
export async function setWithdrawalStatus(db: Db, actor: Actor, id: string, status: "received" | "completed" | "rejected", note: string | null): Promise<void> {
  if (status === "rejected" && !note) throw new WithdrawalError("Give the reason for rejecting (it may be shown to the customer).");
  const [before] = await db<{ order_id: string; status: string }[]>`select order_id, status from public.withdrawal_requests where id = ${id}`;
  if (!before) throw new WithdrawalError("Withdrawal not found.");
  await db`update public.withdrawal_requests set status = ${status}, admin_note = ${note}, handled_by = ${status === "received" ? null : actor.id},
                  handled_at = ${status === "received" ? null : new Date()} where id = ${id}`;
  await logActivity(db, actor, { action: "withdrawal.status", entity: "order", entityId: before.order_id, summary: `Withdrawal ${before.status} → ${status}`, before, after: { status, note } });
}

export function blockMessage(b: WithdrawalBlock): string {
  switch (b) {
    case "not_eu": return "The 14-day withdrawal right applies to orders delivered in the European Union. For other orders, see our returns policy or contact us.";
    case "not_paid": return "This order has not been paid, so there is nothing to withdraw from.";
    case "closed": return "This order is already cancelled or being refunded.";
    case "expired": return "The 14-day withdrawal period for this order has ended. If an item is faulty or not as described, you are still covered by the legal guarantee: please contact us.";
    case "nothing_left": return "You have already withdrawn from every item in this order.";
  }
}

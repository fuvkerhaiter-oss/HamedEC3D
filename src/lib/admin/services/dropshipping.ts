/** Admin dropshipping dashboard: automation controls, pipeline, exception queue, supplier health. */
import type { Db } from "../../db/client";
import type { CurrencyCode } from "../../money";
import { adapterConnection } from "../../suppliers/adapters";
import { adapterInfo } from "../../suppliers/registry";
import { loadAutomationSettings, logAutomation, requeueJob, resolveJobManually, ensureJob } from "../../fulfillment/jobs";
import { parseRules, type AutomationSwitch, type PurchasingRules } from "../../fulfillment/rules";
import { logActivity, type Actor } from "../audit";
import { setSetting } from "./settings";

export async function automationState(db: Db) {
  return loadAutomationSettings(db);
}

export async function setAutomationSwitch(db: Db, actor: Actor, sw: AutomationSwitch): Promise<void> {
  await setSetting(db, actor, "fulfillment.automation", sw);
  await logAutomation(db, { level: sw.killSwitch ? "warn" : "info", event: "automation.switch", message: `${actor.email}: automation ${sw.enabled ? "ON" : "OFF"}, kill switch ${sw.killSwitch ? "ENGAGED" : "released"}` });
}

export async function saveRules(db: Db, actor: Actor, rules: PurchasingRules): Promise<void> {
  const clean = parseRules(rules);
  await setSetting(db, actor, "fulfillment.rules", clean);
  await logAutomation(db, { event: "automation.rules", message: `${actor.email} updated purchasing rules`, data: clean });
}

export async function pipelineCounts(db: Db) {
  const [r] = await db<{
    paid_orders: number; awaiting_fulfilment: number; with_supplier: number; supplier_unpaid: number; in_transit: number; delivered: number;
    failed: number; refunds: number; review: number; dead: number; queued: number; succeeded: number;
  }[]>`
    select
      (select count(*)::int from public.orders where not is_test and status not in ('pending_payment','cancelled')) as paid_orders,
      (select count(*)::int from public.orders where not is_test and status in ('paid','processing')) as awaiting_fulfilment,
      (select count(*)::int from public.orders where not is_test and status in ('submitted_to_supplier','supplier_accepted')) as with_supplier,
      (select count(*)::int from public.supplier_orders so join public.orders o on o.id = so.order_id where not o.is_test and so.status = 'submitted' and so.supplier_payment_status = 'pending') as supplier_unpaid,
      (select count(*)::int from public.orders where not is_test and status = 'shipped') as in_transit,
      (select count(*)::int from public.orders where not is_test and status = 'delivered') as delivered,
      (select count(*)::int from public.orders where not is_test and status = 'failed') as failed,
      (select count(*)::int from public.orders where not is_test and status in ('refund_requested','refunded')) as refunds,
      (select count(*)::int from public.fulfillment_jobs where status = 'manual_review') as review,
      (select count(*)::int from public.fulfillment_jobs where status = 'failed') as dead,
      (select count(*)::int from public.fulfillment_jobs where status in ('queued','running')) as queued,
      (select count(*)::int from public.fulfillment_jobs where status = 'succeeded') as succeeded`;
  return r!;
}

export async function exceptionQueue(db: Db) {
  return db<{ order_id: string; order_number: number; status: string; stage: string | null; review_reason: string | null; last_error: string | null; attempts: number; max_attempts: number; updated_at: Date; total: number; currency: CurrencyCode; order_status: string; is_test: boolean }[]>`
    select j.order_id, o.order_number, j.status, j.stage, j.review_reason, j.last_error, j.attempts, j.max_attempts, j.updated_at,
           o.total, o.currency, o.status::text as order_status, o.is_test
      from public.fulfillment_jobs j join public.orders o on o.id = j.order_id
     where j.status in ('manual_review', 'failed') or (j.status = 'queued' and j.attempts > 0)
     order by (j.status = 'failed') desc, j.updated_at desc limit 100`;
}

/** Paid orders with no fulfillment job (paid before automation existed). */
export async function ordersWithoutJob(db: Db) {
  return db<{ id: string; order_number: number }[]>`
    select o.id, o.order_number from public.orders o
     where o.status = 'paid' and not exists (select 1 from public.fulfillment_jobs j where j.order_id = o.id) order by o.created_at limit 50`;
}

export async function supplierPaymentsPending(db: Db) {
  return db<{ order_id: string; order_number: number; supplier_name: string; supplier_order_ref: string; cost_total: number | null; cost_currency: CurrencyCode | null; created_at: Date; supplier_status_raw: string | null }[]>`
    select so.order_id, o.order_number, s.name as supplier_name, so.supplier_order_ref, so.cost_total, so.cost_currency, so.created_at, so.supplier_status_raw
      from public.supplier_orders so join public.orders o on o.id = so.order_id join public.suppliers s on s.id = so.supplier_id
     where so.status = 'submitted' and so.supplier_payment_status = 'pending' order by so.created_at limit 100`;
}

export async function recentAutomationLogs(db: Db, limit = 40) {
  return db<{ id: number; order_id: string | null; order_number: number | null; level: string; event: string; message: string; created_at: Date }[]>`
    select l.id, l.order_id, o.order_number, l.level, l.event, l.message, l.created_at
      from public.automation_logs l left join public.orders o on o.id = l.order_id order by l.id desc limit ${limit}`;
}

export async function supplierHealth(db: Db) {
  const rows = await db<{ id: string; name: string; adapter_key: string; fulfillment_mode: string; is_active: boolean; is_mock: boolean; supported_countries: string[]; mapped: number; auto: number; orders: number; failed: number; avg_cost: number | null; cost_currency: CurrencyCode | null }[]>`
    select s.id, s.name, s.adapter_key, s.fulfillment_mode, s.is_active, s.is_mock, s.supported_countries,
      (select count(*)::int from public.supplier_products sp where sp.supplier_id = s.id) as mapped,
      (select count(*)::int from public.supplier_products sp where sp.supplier_id = s.id and sp.auto_fulfill) as auto,
      (select count(*)::int from public.supplier_orders so where so.supplier_id = s.id) as orders,
      (select count(*)::int from public.supplier_orders so where so.supplier_id = s.id and so.status in ('failed','manual_required')) as failed,
      (select round(avg(so.cost_total))::bigint from public.supplier_orders so where so.supplier_id = s.id and so.cost_total is not null and so.cost_currency = s.default_currency) as avg_cost,
      s.default_currency as cost_currency
    from public.suppliers s order by s.is_active desc, s.name`;
  return rows.map((r) => ({ ...r, info: adapterInfo(r.adapter_key), connection: adapterConnection(r.adapter_key) }));
}

export async function retryJob(db: Db, actor: Actor, orderId: string): Promise<boolean> {
  await ensureJob(db, orderId);
  const ok = await requeueJob(db, orderId);
  if (ok) {
    await logAutomation(db, { orderId, event: "job.requeued", message: `${actor.email} put the order back in the automatic queue` });
    await logActivity(db, actor, { action: "fulfillment.retry", entity: "order", entityId: orderId, summary: "Automatic fulfillment retried" });
  }
  return ok;
}

export async function markHandledManually(db: Db, actor: Actor, orderId: string, note: string): Promise<boolean> {
  const ok = await resolveJobManually(db, orderId, note || "Handled manually");
  if (ok) {
    await logAutomation(db, { orderId, event: "job.manual", message: `${actor.email}: handled manually${note ? ` — ${note}` : ""}` });
    await logActivity(db, actor, { action: "fulfillment.manual", entity: "order", entityId: orderId, summary: "Fulfillment handled manually", after: { note } });
  }
  return ok;
}

/**
 * Fulfillment job queue (Postgres): one job per paid order (UNIQUE order_id), claimed with
 * FOR UPDATE SKIP LOCKED + a lease, so concurrent workers (cron, post-webhook kick) never run the same job twice.
 * Every step is written to automation_logs.
 */
import type { Db } from "../db/client";
import { getSetting } from "../admin/services/settings";
import { parseRules, parseSwitch, type AutomationSwitch, type PurchasingRules } from "./rules";

export type JobStatus = "queued" | "running" | "succeeded" | "manual_review" | "failed" | "cancelled";

export interface FulfillmentJob {
  id: string;
  order_id: string;
  status: JobStatus;
  stage: string | null;
  attempts: number;
  max_attempts: number;
  next_run_at: Date;
  last_error: string | null;
  review_reason: string | null;
}

export const LEASE_SECONDS = 300;

export async function loadAutomationSettings(db: Db): Promise<{ sw: AutomationSwitch; rules: PurchasingRules }> {
  const [sw, rules] = await Promise.all([getSetting(db, "fulfillment.automation"), getSetting(db, "fulfillment.rules")]);
  return { sw: parseSwitch(sw), rules: parseRules(rules) };
}

export async function logAutomation(
  db: Db,
  e: { orderId?: string | null; jobId?: string | null; supplierOrderId?: string | null; level?: "info" | "warn" | "error"; event: string; message: string; data?: unknown },
): Promise<void> {
  await db`insert into public.automation_logs (order_id, job_id, supplier_order_id, level, event, message, data)
           values (${e.orderId ?? null}, ${e.jobId ?? null}, ${e.supplierOrderId ?? null}, ${e.level ?? "info"}, ${e.event.slice(0, 80)},
                   ${e.message.slice(0, 1000)}, ${db.json(JSON.parse(JSON.stringify(e.data ?? {})))})`;
}

/** Called in the same transaction that marks the order paid. Idempotent (UNIQUE order_id). */
export async function enqueueFulfillmentJob(tx: Db, orderId: string): Promise<boolean> {
  const { rules } = await loadAutomationSettings(tx);
  const rows = await tx`insert into public.fulfillment_jobs (order_id, max_attempts) values (${orderId}, ${rules.maxAttempts})
                        on conflict (order_id) do nothing returning id`;
  if (rows.length) await logAutomation(tx, { orderId, jobId: rows[0]!.id as string, event: "job.queued", message: "Payment verified — automatic fulfillment job queued" });
  return rows.length === 1;
}

/** Claims up to `limit` due jobs (queued and due, or running with an expired lease). */
export async function claimDueJobs(db: Db, limit: number): Promise<FulfillmentJob[]> {
  return db<FulfillmentJob[]>`
    update public.fulfillment_jobs j set status = 'running', attempts = j.attempts + 1,
           locked_until = now() + make_interval(secs => ${LEASE_SECONDS})
     where j.id in (
       select id from public.fulfillment_jobs
        where (status = 'queued' and next_run_at <= now()) or (status = 'running' and locked_until < now())
        order by next_run_at limit ${limit} for update skip locked)
    returning j.*`;
}

/** Leaves a job queued without counting an attempt (kill switch on). */
export async function deferJob(db: Db, id: string, minutes: number, reason: string): Promise<void> {
  await db`update public.fulfillment_jobs set status = 'queued', attempts = greatest(attempts - 1, 0), locked_until = null,
           next_run_at = now() + make_interval(mins => ${minutes}), stage = ${reason.slice(0, 80)} where id = ${id}`;
}

export async function finishJob(
  db: Db, id: string,
  patch: { status: Exclude<JobStatus, "queued" | "running">; stage: string; reviewReason?: string | null; lastError?: string | null },
): Promise<void> {
  await db`update public.fulfillment_jobs set status = ${patch.status}, stage = ${patch.stage}, locked_until = null,
           review_reason = ${patch.reviewReason ?? null}, last_error = coalesce(${patch.lastError ?? null}, last_error) where id = ${id}`;
}

export async function scheduleRetry(db: Db, id: string, delayMs: number, stage: string, error: string): Promise<void> {
  await db`update public.fulfillment_jobs set status = 'queued', locked_until = null, stage = ${stage}, last_error = ${error.slice(0, 1000)},
           next_run_at = now() + make_interval(secs => ${Math.ceil(delayMs / 1000)}) where id = ${id}`;
}

/** Admin: put a manual-review / failed job back in the queue (counts start again). */
export async function requeueJob(db: Db, orderId: string): Promise<boolean> {
  const rows = await db`update public.fulfillment_jobs set status = 'queued', attempts = 0, next_run_at = now(), locked_until = null, review_reason = null
                        where order_id = ${orderId} and status in ('manual_review', 'failed', 'cancelled') returning id`;
  return rows.length === 1;
}

/** Admin: mark a job as handled by hand (the order is fulfilled outside the automation). */
export async function resolveJobManually(db: Db, orderId: string, note: string): Promise<boolean> {
  const rows = await db`update public.fulfillment_jobs set status = 'cancelled', stage = 'handled_manually', review_reason = ${note.slice(0, 500)}, locked_until = null
                        where order_id = ${orderId} and status in ('manual_review', 'failed', 'queued') returning id`;
  return rows.length === 1;
}

/** Admin: create a job for a paid order that has none (e.g. paid before this feature existed). */
export async function ensureJob(db: Db, orderId: string): Promise<void> {
  await db`insert into public.fulfillment_jobs (order_id) values (${orderId}) on conflict (order_id) do nothing`;
}

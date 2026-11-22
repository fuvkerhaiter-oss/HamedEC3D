import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { flushEmailOutbox } from "@/lib/email/outbox";
import { processDueFulfillmentJobs } from "@/lib/fulfillment/worker";
import { syncSupplierOrders } from "@/lib/fulfillment/tracking-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Fulfillment worker tick: runs due automatic-fulfillment jobs, then supplier status/tracking sync, then sends
 * queued customer emails. Call every 5–15 minutes from a scheduler with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron on Pro, or any external cron). Safe to run concurrently: jobs and syncs are claimed with SKIP LOCKED.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const db = getSql();
  const jobs = await processDueFulfillmentJobs(db, { limit: 5 });
  const sync = await syncSupplierOrders(db, { limit: 20 });
  const emails = await flushEmailOutbox(db, 50);
  return NextResponse.json({ jobs: { processed: jobs.processed, outcomes: jobs.results.map((r) => r.outcome) }, sync, emails });
}

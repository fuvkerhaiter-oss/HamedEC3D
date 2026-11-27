import { NextResponse } from "next/server";
import { expireStalePendingOrders } from "@/lib/checkout/service";
import { CATALOG_TAG, expirePublicData } from "@/lib/cache/public-data";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { flushEmailOutbox } from "@/lib/email/outbox";
import { logError } from "@/lib/log";
import { syncMissingPaymentFinancials } from "@/lib/payments/financials";
import { processDueFulfillmentJobs } from "@/lib/fulfillment/worker";
import { syncSupplierOrders } from "@/lib/fulfillment/tracking-sync";
import { getPaymentProvider } from "@/lib/payments/registry";
import { queueRentalReminders } from "@/lib/rentals/service";
import { purgeOldVisits } from "@/lib/visitors/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Backstop job (Vercel Cron, see vercel.json; sends `Authorization: Bearer $CRON_SECRET`): retries unsent
 * customer emails, releases stock held by checkouts that were never paid, and fills Stripe fee records. Both also run inline after
 * each payment/checkout, so this only catches what failed there.
 * Steps are independent: one failing (e.g. Stripe briefly down) is logged and never skips the others; the
 * response is 500 with the failed step names so the cron dashboard shows it.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const db = getSql();
  const failed: string[] = [];
  const step = async <T,>(name: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (e) {
      failed.push(name);
      logError(`cron maintenance: ${name} failed`, e);
      return null;
    }
  };

  const expired = await step("expire-pending", () => expireStalePendingOrders(db));
  if (expired) expirePublicData(CATALOG_TAG); // released stock
  // Daily backstop for the fulfillment worker (the frequent tick is /api/cron/fulfillment).
  const jobs = await step("fulfillment", () => processDueFulfillmentJobs(db, { limit: 10 }));
  const sync = await step("supplier-sync", () => syncSupplierOrders(db, { limit: 50 }));
  const rentalReminders = await step("rental-reminders", () => queueRentalReminders(db)); // rentals ending within 7 days
  const visitsPurged = await step("visit-retention", () => purgeOldVisits(db)); // visitor log retention (privacy policy)
  const emails = await step("email-outbox", () => flushEmailOutbox(db, 100));
  const financials = await step("payment-financials", () => syncMissingPaymentFinancials(db, (id) => getPaymentProvider(id))); // Stripe fees

  return NextResponse.json(
    { expired, rentalReminders, visitsPurged, emails, financials, jobs: jobs?.processed ?? null, sync, failed },
    { status: failed.length ? 500 : 200 },
  );
}

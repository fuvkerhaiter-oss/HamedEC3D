import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { expireStalePendingOrders } from "@/lib/checkout/service";
import { CATALOG_TAG, expirePublicData } from "@/lib/cache/public-data";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { flushEmailOutbox } from "@/lib/email/outbox";
import { syncMissingPaymentFinancials } from "@/lib/payments/financials";
import { getPaymentProvider } from "@/lib/payments/registry";

export const dynamic = "force-dynamic";

/**
 * Backstop job (Vercel Cron, see vercel.json; sends `Authorization: Bearer $CRON_SECRET`): retries unsent
 * customer emails, releases stock held by checkouts that were never paid, and fills Stripe fee records. Both also run inline after
 * each payment/checkout, so this only catches what failed there.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (secret.length < 16 || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const db = getSql();
  const expired = await expireStalePendingOrders(db);
  if (expired) expirePublicData(CATALOG_TAG); // released stock
  const emails = await flushEmailOutbox(db, 100);
  const financials = await syncMissingPaymentFinancials(db, (id) => getPaymentProvider(id)); // Stripe fees from balance transactions
  return NextResponse.json({ expired, emails, financials });
}

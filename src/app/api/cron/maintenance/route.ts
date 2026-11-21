import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { expireStalePendingOrders } from "@/lib/checkout/service";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { flushEmailOutbox } from "@/lib/email/outbox";

export const dynamic = "force-dynamic";

/**
 * Backstop job (Vercel Cron, see vercel.json; sends `Authorization: Bearer $CRON_SECRET`): retries unsent
 * customer emails and releases stock held by checkouts that were never paid. Both also run inline after
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
  const emails = await flushEmailOutbox(db, 100);
  return NextResponse.json({ expired, emails });
}

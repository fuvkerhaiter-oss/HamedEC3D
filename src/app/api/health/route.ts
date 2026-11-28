import { NextResponse } from "next/server";
import { loadShippingZones } from "@/lib/admin/services/shipping";
import { checkoutUnavailableReason, legalBlocker } from "@/lib/checkout/service";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { logError } from "@/lib/log";
import { marketCountries } from "@/lib/markets";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { shippingCoverage } from "@/lib/shipping/quote";

export const dynamic = "force-dynamic";

const timeout = <T,>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), ms))]);

/**
 * Uptime check for an external monitor (UptimeRobot, Better Stack, Vercel checks…).
 * - HTTP 200 when the app and the database answer, 503 otherwise (point the uptime alert at the status code).
 * - `checkout`: true only when an order could really be placed right now: a payment provider is configured, the
 *   legal launch gate passes and at least one market country has a priced shipping method. Monitor it with a
 *   keyword check ("checkout":true) to be told when selling stops. Each part is actually checked; anything that
 *   could not be checked counts as false.
 * Reveals booleans only: no configuration values, versions, reasons or secrets.
 */
export async function GET(req: Request) {
  if (rateLimited(`health:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  let db = false;
  let checkout = false;
  if (isDbConfigured()) {
    const sql = getSql();
    try {
      await timeout(sql`select 1`, 3000, "health db");
      db = true;
    } catch (e) {
      logError("health: database check failed", e);
    }
    if (db && !checkoutUnavailableReason()) {
      try {
        const [legal, zones] = await timeout(Promise.all([legalBlocker(sql, { ...process.env, NODE_ENV: "production" }), loadShippingZones(sql)]), 3000, "health checkout");
        checkout = !legal && shippingCoverage(zones, marketCountries()).some((c) => c.shippable);
      } catch (e) {
        logError("health: checkout readiness check failed", e);
      }
    }
  }
  return NextResponse.json({ ok: db, db, checkout }, { status: db ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

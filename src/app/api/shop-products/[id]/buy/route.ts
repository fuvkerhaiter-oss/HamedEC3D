/**
 * "Buy" on a shop renter's product in the 3D store: counts the click, then sends the shopper to the renter's own
 * payment link (their Stripe/PayPal/Shopify page). Only while the product is on show in a rented, open shop.
 * The money goes straight to the renter; this platform never sees the payment.
 */
import { NextResponse } from "next/server";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { buyTarget } from "@/lib/tenants/service";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = new URL("/store", req.url);
  if (!isDbConfigured()) return NextResponse.redirect(back, 302);
  // Abuse guard: counting stops (the redirect still works) for a burst from one address.
  const count = !rateLimited(`shop-buy:${clientIp(req)}`, 60, 60_000);
  const url = await buyTarget(getSql(), id, new Date(), count);
  if (!url) return NextResponse.redirect(back, 302);
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

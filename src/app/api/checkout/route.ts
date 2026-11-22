import { NextResponse } from "next/server";
import { OrderError } from "@/lib/admin/services/orders";
import { siteUrl } from "@/lib/checkout/order-link";
import { CheckoutBody } from "@/lib/checkout/schema";
import { checkoutProvider, checkoutUnavailableReason, expireStalePendingOrders, legalBlocker, startCheckout } from "@/lib/checkout/service";
import { CATALOG_TAG, expirePublicData } from "@/lib/cache/public-data";
import { getSql } from "@/lib/db/client";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Place an order and get the payment page URL. The client sends only ids, quantities, address and the chosen
 * shipping method; every amount is recomputed and stock is reserved on the server.
 */
export async function POST(req: Request) {
  if (rateLimited(`checkout:${clientIp(req)}`, 10, 60_000)) return NextResponse.json({ error: "Too many attempts. Please wait a minute." }, { status: 429 });
  const unavailable = checkoutUnavailableReason();
  const provider = checkoutProvider();
  if (unavailable || !provider) return NextResponse.json({ error: unavailable ?? "Payments are not configured." }, { status: 503 });
  const parsed = CheckoutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") ?? "";
    if (issue?.code === "custom") return NextResponse.json({ error: issue.message }, { status: 400 });
    return NextResponse.json({ error: field === "acceptTerms" ? "Please accept the Terms of Sale." : `Please check: ${field || "your details"}` }, { status: 400 });
  }
  const db = getSql();
  const legal = await legalBlocker(db);
  if (legal) return NextResponse.json({ error: `Checkout is not open yet. ${legal}` }, { status: 503 });
  void expireStalePendingOrders(db).catch((e) => logError("pending order expiry failed", e));
  try {
    const input = { ...parsed.data, acceptTerms: undefined };
    const result = await startCheckout(db, input, { provider, siteUrl: siteUrl(req) });
    expirePublicData(CATALOG_TAG); // stock was reserved: shown stock refreshes on the next page view
    return NextResponse.json({ redirectUrl: result.redirectUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof OrderError) return NextResponse.json({ error: e.message }, { status: 422 });
    // reserve_order_inventory raises when someone else bought the last units in the meantime.
    if (e instanceof Error && /stock|inventory/i.test(e.message)) {
      return NextResponse.json({ error: "Sorry, an item just sold out. Please review your cart." }, { status: 409 });
    }
    logError("checkout failed", e);
    return NextResponse.json({ error: "We couldn't start the payment. You have not been charged. Please try again." }, { status: 502 });
  }
}

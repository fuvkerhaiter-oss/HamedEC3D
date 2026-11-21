import { NextResponse } from "next/server";
import { OrderError, priceOrder } from "@/lib/admin/services/orders";
import { QuoteBody } from "@/lib/checkout/schema";
import { checkoutUnavailableReason } from "@/lib/checkout/service";
import { getSql } from "@/lib/db/client";
import { clientIp, rateLimited } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Checkout preview for a destination: shipping options + final server totals (tax, discount, shipping). */
export async function POST(req: Request) {
  if (rateLimited(`quote:${clientIp(req)}`, 60, 60_000)) return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });
  const unavailable = checkoutUnavailableReason();
  if (unavailable) return NextResponse.json({ error: unavailable, unavailable: true }, { status: 503 });
  const parsed = QuoteBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const b = parsed.data;
  const base = {
    lines: b.lines,
    shipTo: { country: b.country, region: b.region, fullName: "", line1: "", city: "", postalCode: "" },
    email: "",
    couponCode: b.couponCode,
  };
  try {
    // A method chosen for another country may not exist here: fall back to the cheapest one.
    const r = await priceOrder(getSql(), { ...base, shippingMethodId: b.shippingMethodId }).catch((e) => {
      if (b.shippingMethodId && e instanceof OrderError && /shipping method/.test(e.message)) return priceOrder(getSql(), base);
      throw e;
    });
    return NextResponse.json({ cart: r.priced, options: r.options, selectedMethodId: r.option.methodId }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof OrderError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("checkout quote failed", e);
    return NextResponse.json({ error: "Could not calculate your total. Please try again." }, { status: 502 });
  }
}

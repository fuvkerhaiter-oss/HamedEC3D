import { NextResponse } from "next/server";
import { z } from "zod";
import { priceCart, MAX_CART_LINES } from "@/lib/cart/pricing";
import { getCatalogReader } from "@/lib/catalog/source";
import { MARKETS } from "@/lib/markets";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { loadCouponForCode } from "@/lib/admin/services/coupons";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

const Body = z.object({
  market: z.enum(["EU", "US"]),
  lines: z
    .array(z.object({ variantId: z.string().min(1).max(100), quantity: z.number().int() }))
    .max(MAX_CART_LINES),
  /** Optional discount code — validated on the server (admin-managed `discounts`). */
  couponCode: z.string().trim().min(1).max(40).optional(),
});

/** Authoritative cart pricing: the client sends only variant ids + quantities (+ an optional code). */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid cart request" }, { status: 400 });

  const market = MARKETS[parsed.data.market];
  try {
    const reader = await getCatalogReader(parsed.data.lines.map((l) => l.variantId));
    const opts = { currency: market.currency, taxMode: market.taxMode };
    let cart = await priceCart(parsed.data.lines, reader, opts);
    let coupon: { code: string; applied: boolean; message: string } | undefined;
    if (parsed.data.couponCode) {
      if (!isDbConfigured()) {
        coupon = { code: parsed.data.couponCode, applied: false, message: "Discount codes are not available yet." };
      } else {
        const lines = await Promise.all(cart.lines.map(async (l) => ({
          productId: l.productId, categoryId: (await reader.getVariant(l.variantId))?.product.categoryId ?? "", lineTotal: l.lineTotal.amount,
        })));
        const { result } = await loadCouponForCode(getSql(), parsed.data.couponCode, { currency: market.currency, now: new Date(), lines });
        if (result.ok) {
          cart = await priceCart(parsed.data.lines, reader, { ...opts, discount: result.discount });
          coupon = { code: result.discount.code, applied: true, message: "Code applied." };
        } else {
          coupon = { code: parsed.data.couponCode, applied: false, message: result.reason };
        }
      }
    }
    return NextResponse.json(coupon ? { ...cart, coupon } : cart, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    logError("cart pricing failed", err);
    return NextResponse.json({ error: "Could not price cart" }, { status: 502 });
  }
}

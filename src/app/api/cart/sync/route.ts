import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/server";
import { loadUserCart, saveUserCart } from "@/lib/cart/persistence";
import { mergeCartLines } from "@/lib/cart/merge";
import { MAX_CART_LINES } from "@/lib/cart/pricing";
import { MARKETS, type MarketId } from "@/lib/markets";

export const dynamic = "force-dynamic";

const SyncBody = z.object({
  guestLines: z.array(z.object({
    variantId: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(99),
  })).max(MAX_CART_LINES),
  market: z.enum(["EU", "US"]).optional().default("EU"),
});

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ authenticated: false, lines: [] }, { status: 200 });
  }

  const lines = await loadUserCart(user.id);
  return NextResponse.json({ authenticated: true, lines }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ authenticated: false, message: "User is a guest" }, { status: 200 });
  }

  const parsed = SyncBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sync request" }, { status: 400 });
  }

  const { guestLines, market } = parsed.data;
  const currency = MARKETS[market as MarketId].currency;

  const existingAccountLines = await loadUserCart(user.id);
  const result = mergeCartLines(guestLines, existingAccountLines);

  await saveUserCart(user.id, result.lines, currency);

  return NextResponse.json({
    authenticated: true,
    lines: result.lines,
    conflicts: result.conflicts,
    mergedCount: result.mergedCount,
  }, { headers: { "Cache-Control": "no-store" } });
}

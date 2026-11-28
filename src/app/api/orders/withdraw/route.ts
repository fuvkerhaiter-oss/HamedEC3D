import { after, NextResponse } from "next/server";
import { z } from "zod";
import { verifyOrderToken } from "@/lib/checkout/order-link";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { flushEmailOutbox } from "@/lib/email/outbox";
import { logError } from "@/lib/log";
import { submitWithdrawal, WithdrawalError } from "@/lib/orders/withdrawal";
import { clientIp, rateLimitedShared } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const Body = z.object({
  orderId: z.string().uuid(),
  token: z.string().min(10).max(100),
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(254),
  reason: z.string().trim().max(1000).optional().transform((v) => v || null),
  items: z.array(z.object({ orderItemId: z.string().uuid(), quantity: z.number().int().min(0).max(99) })).min(1).max(200),
});

/** "Confirm withdrawal" (EU online withdrawal function). The signed order token proves access to the order. */
export async function POST(req: Request) {
  if (await rateLimitedShared(`withdraw:${clientIp(req)}`, 5, 60_000)) return NextResponse.json({ error: "Too many attempts. Please wait a minute." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please enter your name, a valid email and choose at least one item." }, { status: 400 });
  const b = parsed.data;
  if (!verifyOrderToken(b.orderId, b.token)) return NextResponse.json({ error: "This link is not valid. Open the withdrawal form again from your order email or the order lookup." }, { status: 403 });
  if (!isDbConfigured()) return NextResponse.json({ error: "Withdrawal is not available online right now. Please email us your withdrawal statement." }, { status: 503 });
  try {
    const r = await submitWithdrawal(getSql(), { orderId: b.orderId, fullName: b.fullName, confirmationEmail: b.email, reason: b.reason, items: b.items });
    after(() => flushEmailOutbox(getSql()).catch((e) => logError("email flush failed", e)));
    return NextResponse.json({ ok: true, submittedAt: r.submittedAt, wholeOrder: r.wholeOrder });
  } catch (e) {
    if (e instanceof WithdrawalError) return NextResponse.json({ error: e.message }, { status: 409 });
    logError("withdrawal failed", e);
    return NextResponse.json({ error: "Something went wrong and your withdrawal was NOT recorded. Please try again or email us your withdrawal statement." }, { status: 500 });
  }
}

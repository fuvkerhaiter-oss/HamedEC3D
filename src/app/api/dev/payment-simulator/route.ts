import { after, NextResponse } from "next/server";
import { flushEmailOutbox } from "@/lib/email/outbox";
import { orderUrl, siteUrl } from "@/lib/checkout/order-link";
import { getSql, type Tx } from "@/lib/db/client";
import type { CurrencyCode } from "@/lib/money";
import type { createDevPaymentSimulator } from "@/lib/payments/dev-simulator";
import { pgWebhookStore } from "@/lib/payments/pg-store";
import { getPaymentProvider } from "@/lib/payments/registry";
import { handlePaymentWebhook } from "@/lib/payments/webhook";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * DEVELOPMENT ONLY: plays the payment provider. Sends a signed simulator webhook through the same verification,
 * dedupe and state-machine path a real Stripe webhook uses. 404 in production or when the simulator is off.
 */
export async function POST(req: Request) {
  const sim = getPaymentProvider("dev-simulator") as ReturnType<typeof createDevPaymentSimulator> | null;
  if (process.env.NODE_ENV === "production" || !sim) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const orderId = String(form.get("order") ?? "");
  const session = String(form.get("session") ?? "");
  const outcome = form.get("outcome") === "fail" ? "payment.failed" : "payment.succeeded";
  const db = getSql();
  const [o] = await db<{ total: number; currency: CurrencyCode }[]>`select total, currency from public.orders where id = ${orderId}`;
  if (!o) return NextResponse.json({ error: "Unknown order" }, { status: 404 });
  const { rawBody, headers } = sim.buildWebhook({ type: outcome, orderId, providerPaymentId: `sim_pi_${session}`, amount: { amount: Number(o.total), currency: o.currency } });
  await db.begin((tx) => handlePaymentWebhook(sim, rawBody, headers, pgWebhookStore(tx as unknown as Tx, { isTest: true })));
  after(() => flushEmailOutbox(db).catch((e) => logError("email flush failed", e)));
  return NextResponse.redirect(`${orderUrl(siteUrl(req), orderId)}&paid=1`, 303);
}

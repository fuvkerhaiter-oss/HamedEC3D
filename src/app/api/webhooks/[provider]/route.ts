import { after, NextResponse } from "next/server";
import { flushEmailOutbox } from "@/lib/email/outbox";
import { getSql, isDbConfigured, type Tx } from "@/lib/db/client";
import { pgWebhookStore } from "@/lib/payments/pg-store";
import { getPaymentProvider } from "@/lib/payments/registry";
import { WebhookVerificationError } from "@/lib/payments/types";
import { handlePaymentWebhook } from "@/lib/payments/webhook";
import { logError } from "@/lib/log";
import { processDueFulfillmentJobs } from "@/lib/fulfillment/worker";

export const dynamic = "force-dynamic";

/** Payment provider webhooks: signature verified over the raw body, deduplicated, then applied via the order state machine. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: id } = await params;
  const provider = getPaymentProvider(id);
  if (!provider || !isDbConfigured()) return NextResponse.json({ error: "Provider not configured" }, { status: 404 });
  const raw = await req.text();
  try {
    // One transaction: if applying the event fails, the dedupe record rolls back too, so the provider's retry is processed.
    const result = await getSql().begin((tx) => handlePaymentWebhook(provider, raw, req.headers, pgWebhookStore(tx as unknown as Tx, { isTest: provider.isSandbox })));
    after(async () => {
      // After the response: run the fulfillment job this payment queued (cron is the backstop if this is cut short).
      if (result.status === "processed" && result.orderStatus === "paid") await processDueFulfillmentJobs(getSql(), { limit: 2 }).catch((e) => logError("fulfillment kick failed", e));
      await flushEmailOutbox(getSql()).catch((e) => logError("email flush failed", e));
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WebhookVerificationError) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    logError("webhook processing failed", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 }); // provider retries; dedupe protects us
  }
}

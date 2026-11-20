import { NextResponse } from "next/server";
import { getSql, isDbConfigured, type Tx } from "@/lib/db/client";
import { pgWebhookStore } from "@/lib/payments/pg-store";
import { getPaymentProvider } from "@/lib/payments/registry";
import { WebhookVerificationError } from "@/lib/payments/types";
import { handlePaymentWebhook } from "@/lib/payments/webhook";

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
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WebhookVerificationError) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    console.error("webhook processing failed", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 }); // provider retries; dedupe protects us
  }
}

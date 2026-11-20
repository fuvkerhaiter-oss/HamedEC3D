/**
 * Payment provider abstraction. Checkout talks only to this interface, so providers
 * can be added without rewriting checkout. Payment truth comes ONLY from verified
 * webhooks or server-side provider lookups — never from the client.
 */
import type { Money } from "../money";

export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded" | "partially_refunded";

export interface CreateSessionInput {
  orderId: string;
  amount: Money;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface PaymentSession {
  providerSessionId: string;
  redirectUrl: string;
}

export interface PaymentEvent {
  /** Provider's unique event id — used to deduplicate webhook deliveries. */
  eventId: string;
  type: "payment.succeeded" | "payment.failed" | "refund.succeeded";
  /** null when the provider event doesn't carry it (e.g. refunds); resolved via providerPaymentId. */
  orderId: string | null;
  providerPaymentId: string;
  amount: Money;
  occurredAt: string;
}

export class WebhookVerificationError extends Error {
  override name = "WebhookVerificationError";
}

export interface PaymentProvider {
  readonly id: string;
  /** True for sandbox/simulator providers. Live checkout must refuse these. */
  readonly isSandbox: boolean;
  createSession(input: CreateSessionInput): Promise<PaymentSession>;
  /**
   * Verify signature over the RAW request body, then parse. Throws WebhookVerificationError.
   * Returns null for authentic events we don't act on (they are still acknowledged with 200).
   */
  verifyWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null>;
  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus>;
  refund(providerPaymentId: string, amount: Money, idempotencyKey: string): Promise<{ refundId: string }>;
}

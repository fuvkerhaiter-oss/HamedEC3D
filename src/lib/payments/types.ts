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
  /** Shown to the customer on the payment page, e.g. "WEGO SHIIIP order #1042". */
  label?: string;
}

export interface PaymentSession {
  providerSessionId: string;
  redirectUrl: string;
}

export interface PaymentEvent {
  /** Provider's unique event id — used to deduplicate webhook deliveries. */
  eventId: string;
  type: "payment.succeeded" | "payment.failed" | "refund.succeeded" | "refund.updated";
  /** null when the provider event doesn't carry it (e.g. refunds); resolved via providerPaymentId. */
  orderId: string | null;
  providerPaymentId: string;
  amount: Money;
  occurredAt: string;
  /** refund.updated only: the provider refund and its current status. */
  refund?: { providerRefundId: string; status: ProviderRefundStatus; localRefundId?: string | null };
}

export type ProviderRefundStatus = "succeeded" | "pending" | "failed" | "canceled";

/** Actual settlement figures from the provider's balance transaction (never estimated). */
export interface BalanceFigures {
  transactionId: string;
  gross: number;
  fee: number;
  net: number;
  /** ISO 4217, upper case. May differ from the payment currency. */
  currency: string;
}

/** Payment as reported by the provider's own API (server-side lookup with the secret key). */
export interface VerifiedPayment {
  status: "succeeded" | "pending" | "failed" | "canceled";
  amountReceived: Money;
  /** null when the provider lookup doesn't report it. */
  amountRefunded: number | null;
  livemode: boolean | null;
  /** null when the balance transaction isn't available yet. */
  balance: BalanceFigures | null;
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
  /** Independent server-side lookup (Stripe). Absent for providers without one (dev simulator). */
  retrievePayment?(providerPaymentId: string): Promise<VerifiedPayment>;
  refund(
    providerPaymentId: string,
    amount: Money,
    idempotencyKey: string,
    meta?: { localRefundId: string; orderId: string },
  ): Promise<{ refundId: string; status: ProviderRefundStatus }>;
}

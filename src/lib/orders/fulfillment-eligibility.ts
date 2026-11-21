/**
 * Server-side fulfillment eligibility. An order may enter supplier fulfillment ONLY when its payment was
 * confirmed by a verified provider webhook AND (for providers with a server-side lookup, i.e. Stripe) the
 * provider still reports it as succeeded for the full order amount, checked immediately before fulfillment.
 * The database enforces the same rule (`order_has_verified_payment` triggers) as a backstop.
 */
import type { Db } from "../db/client";
import type { CurrencyCode } from "../money";
import type { PaymentProvider } from "../payments/types";
import type { OrderStatus } from "./state-machine";

export class FulfillmentEligibilityError extends Error {
  override name = "FulfillmentEligibilityError";
}

/** Order statuses from which fulfillment work may start or continue. `failed` = supplier failure after payment. */
export const FULFILLABLE_STATUSES: readonly OrderStatus[] = ["paid", "processing", "submitted_to_supplier", "failed"];

export interface EligibilityPayment {
  id: string;
  provider: string;
  providerPaymentId: string | null;
  status: string;
  amount: number;
  refundedAmount: number;
  currency: CurrencyCode;
}

export interface EligibilityInput {
  order: { status: OrderStatus; total: number; currency: CurrencyCode };
  payments: EligibilityPayment[];
  /** A status event to `paid` written by the verified payment webhook exists. */
  paidByVerifiedWebhook: boolean;
  /** Refunds still waiting for the provider (amount, minor units). */
  pendingRefundAmount: number;
}

export type Eligibility = { ok: true; payment: EligibilityPayment } | { ok: false; reason: string };

/** Pure rule (unit-tested). Rejects unpaid, pending, failed, cancelled, refunded or mismatching payments. */
export function evaluateFulfillmentEligibility(i: EligibilityInput): Eligibility {
  if (!FULFILLABLE_STATUSES.includes(i.order.status)) {
    return { ok: false, reason: `Order is ${i.order.status}; only paid orders can be sent to a supplier` };
  }
  if (!i.paidByVerifiedWebhook) return { ok: false, reason: "Order was never confirmed as paid by a verified payment webhook" };
  const payment = i.payments.find(
    (p) =>
      (p.status === "succeeded" || p.status === "partially_refunded") &&
      !!p.providerPaymentId &&
      p.amount === i.order.total &&
      p.currency === i.order.currency,
  );
  if (!payment) {
    const s = i.payments.map((p) => p.status).join(", ") || "none";
    return { ok: false, reason: `No successful payment for the full order amount (payments: ${s})` };
  }
  if (payment.refundedAmount + i.pendingRefundAmount >= payment.amount) {
    return { ok: false, reason: "The payment is (being) fully refunded" };
  }
  return { ok: true, payment };
}

/**
 * Loads the order (row-locked when `db` is a transaction), evaluates eligibility, then re-verifies the
 * payment with the provider. Throws FulfillmentEligibilityError when not eligible. Fails CLOSED: if the
 * provider cannot be reached or is not configured, fulfillment is refused.
 */
export async function assertFulfillmentEligible(
  db: Db,
  orderId: string,
  deps: { getProvider: (id: string) => PaymentProvider | null; env?: NodeJS.ProcessEnv },
): Promise<EligibilityPayment> {
  const env = deps.env ?? process.env;
  const [order] = await db<{ status: OrderStatus; total: number; currency: CurrencyCode }[]>`
    select status, total, currency from public.orders where id = ${orderId} for update`;
  if (!order) throw new FulfillmentEligibilityError("Order not found");
  const payments = await db<{ id: string; provider: string; provider_payment_id: string | null; status: string; amount: number; refunded_amount: number; currency: CurrencyCode }[]>`
    select id, provider, provider_payment_id, status::text as status, amount, refunded_amount, currency from public.payments where order_id = ${orderId}`;
  const [{ paid, pending } = { paid: false, pending: 0 }] = await db<{ paid: boolean; pending: number }[]>`
    select exists (select 1 from public.order_status_events where order_id = ${orderId} and to_status = 'paid' and actor_type = 'payment_webhook') as paid,
           (select coalesce(sum(amount), 0)::int from public.refunds where order_id = ${orderId} and status = 'pending') as pending`;
  const result = evaluateFulfillmentEligibility({
    order,
    payments: payments.map((p) => ({ id: p.id, provider: p.provider, providerPaymentId: p.provider_payment_id, status: p.status, amount: Number(p.amount), refundedAmount: Number(p.refunded_amount), currency: p.currency })),
    paidByVerifiedWebhook: paid,
    pendingRefundAmount: Number(pending),
  });
  if (!result.ok) throw new FulfillmentEligibilityError(result.reason);

  const pay = result.payment;
  const provider = deps.getProvider(pay.provider);
  if (pay.provider === "dev-simulator") {
    // Local simulator has no independent lookup; it can never run in production.
    if (env.NODE_ENV === "production") throw new FulfillmentEligibilityError("Simulator payments are never fulfilled in production");
    return pay;
  }
  if (!provider?.retrievePayment) {
    throw new FulfillmentEligibilityError(`Cannot re-verify the ${pay.provider} payment (provider not configured) — fulfillment refused`);
  }
  let verified;
  try {
    verified = await provider.retrievePayment(pay.providerPaymentId!);
  } catch (e) {
    throw new FulfillmentEligibilityError(`Could not re-verify the payment with ${pay.provider}: ${(e as Error).message}`);
  }
  if (verified.status !== "succeeded") throw new FulfillmentEligibilityError(`${pay.provider} reports the payment as ${verified.status}`);
  if (verified.amountReceived.amount !== pay.amount || verified.amountReceived.currency !== pay.currency) {
    throw new FulfillmentEligibilityError(`${pay.provider} reports a different amount received than the order total`);
  }
  if (verified.amountRefunded !== null && verified.amountRefunded >= pay.amount) {
    throw new FulfillmentEligibilityError(`${pay.provider} reports the payment as fully refunded`);
  }
  return pay;
}

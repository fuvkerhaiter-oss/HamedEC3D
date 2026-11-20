/**
 * DEVELOPMENT PAYMENT SIMULATOR — clearly labelled, never usable in production.
 * Signs webhooks with HMAC-SHA256 so the real verification path is exercised.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { type Money } from "../money";
import { WebhookVerificationError, type PaymentEvent, type PaymentProvider, type PaymentStatus } from "./types";

export const SIMULATOR_SIGNATURE_HEADER = "x-sim-signature";
const MAX_SKEW_SECONDS = 300;

export function assertSimulatorAllowed(env: string | undefined = process.env.NODE_ENV): void {
  if (env === "production") throw new Error("Payment simulator is disabled in production");
}

export function signSimulatorPayload(rawBody: string, secret: string, timestamp: number): string {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

export function createDevPaymentSimulator(opts: { secret: string; baseUrl: string; now?: () => number; env?: string }): PaymentProvider & {
  /** Build a signed webhook as the simulator "provider" would send it. */
  buildWebhook(event: Omit<PaymentEvent, "eventId" | "occurredAt"> & { eventId?: string }): { rawBody: string; headers: Headers };
} {
  assertSimulatorAllowed(opts.env);
  if (opts.secret.length < 16) throw new Error("Simulator webhook secret must be at least 16 characters");
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const payments = new Map<string, PaymentStatus>();

  return {
    id: "dev-simulator",
    isSandbox: true,

    async createSession(input) {
      const providerSessionId = `sim_sess_${randomUUID()}`;
      const url = new URL("/dev/payment-simulator", opts.baseUrl);
      url.searchParams.set("session", providerSessionId);
      url.searchParams.set("order", input.orderId);
      return { providerSessionId, redirectUrl: url.toString() };
    },

    buildWebhook(event) {
      const full: PaymentEvent = { ...event, eventId: event.eventId ?? `sim_evt_${randomUUID()}`, occurredAt: new Date(now() * 1000).toISOString() };
      payments.set(full.providerPaymentId, full.type === "payment.succeeded" ? "succeeded" : full.type === "refund.succeeded" ? "refunded" : "failed");
      const rawBody = JSON.stringify(full);
      const headers = new Headers({ [SIMULATOR_SIGNATURE_HEADER]: signSimulatorPayload(rawBody, opts.secret, now()) });
      return { rawBody, headers };
    },

    async verifyWebhook(rawBody, headers) {
      const header = headers.get(SIMULATOR_SIGNATURE_HEADER);
      const match = header && /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header);
      if (!match) throw new WebhookVerificationError("Missing or malformed signature");
      const ts = Number(match[1]);
      if (Math.abs(now() - ts) > MAX_SKEW_SECONDS) throw new WebhookVerificationError("Signature timestamp outside tolerance");
      const expected = Buffer.from(signSimulatorPayload(rawBody, opts.secret, ts).split("v1=")[1]!, "hex");
      const given = Buffer.from(match[2]!, "hex");
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
        throw new WebhookVerificationError("Invalid signature");
      }
      return JSON.parse(rawBody) as PaymentEvent;
    },

    async getPaymentStatus(providerPaymentId) {
      return payments.get(providerPaymentId) ?? "pending";
    },

    async refund(providerPaymentId, _amount: Money, idempotencyKey) {
      payments.set(providerPaymentId, "refunded");
      return { refundId: `sim_ref_${idempotencyKey}` };
    },
  };
}

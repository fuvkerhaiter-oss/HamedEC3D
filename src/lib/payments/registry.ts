/**
 * Payment provider registry from environment. A provider is "configured" only with credentials;
 * nothing here claims a provider works — sandbox round-trips must be verified separately.
 */
import { createDevPaymentSimulator } from "./dev-simulator";
import { createStripeProvider } from "./stripe";
import type { PaymentProvider } from "./types";

export interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  mode: "test" | "live" | "simulator" | "not_configured";
  detail: string;
}

export function paymentProviderStatuses(env: NodeJS.ProcessEnv = process.env): ProviderStatus[] {
  const key = env.STRIPE_SECRET_KEY ?? "";
  const stripe: ProviderStatus = !key
    ? { id: "stripe", name: "Stripe", configured: false, mode: "not_configured", detail: "STRIPE_SECRET_KEY is not set. Payments and refunds through Stripe are unavailable." }
    : !env.STRIPE_WEBHOOK_SECRET
      ? { id: "stripe", name: "Stripe", configured: false, mode: key.includes("_test_") ? "test" : "live", detail: "STRIPE_WEBHOOK_SECRET is missing — payment confirmations cannot be verified." }
      : { id: "stripe", name: "Stripe", configured: true, mode: key.includes("_test_") ? "test" : "live", detail: key.includes("_test_") ? "Test mode keys present. Verify with a sandbox payment before going live." : "Live keys present." };
  const simOn = env.PAYMENT_PROVIDER === "dev-simulator" && env.NODE_ENV !== "production" && (env.DEV_PAYMENT_WEBHOOK_SECRET ?? "").length >= 16;
  const sim: ProviderStatus = {
    id: "dev-simulator",
    name: "Development payment simulator",
    configured: simOn,
    mode: simOn ? "simulator" : "not_configured",
    detail: "Local development only — not a real payment provider. Disabled in production.",
  };
  return [stripe, sim];
}

export function getPaymentProvider(id: string, env: NodeJS.ProcessEnv = process.env): PaymentProvider | null {
  const status = paymentProviderStatuses(env).find((s) => s.id === id);
  if (!status?.configured) return null;
  if (id === "stripe") return createStripeProvider({ secretKey: env.STRIPE_SECRET_KEY!, webhookSecret: env.STRIPE_WEBHOOK_SECRET!, allowLive: env.STRIPE_ALLOW_LIVE === "true" });
  if (id === "dev-simulator") return createDevPaymentSimulator({ secret: env.DEV_PAYMENT_WEBHOOK_SECRET!, baseUrl: env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000" });
  return null;
}

import type { Metadata } from "next";
import { CheckoutForm } from "@/features/checkout/CheckoutForm";
import { checkoutUnavailableReason, legalBlocker } from "@/lib/checkout/service";
import { getSql } from "@/lib/db/client";
import { loadShippingZones } from "@/lib/admin/services/shipping";
import { marketCountries } from "@/lib/markets";
import { shippingCoverage } from "@/lib/shipping/quote";
import { logError } from "@/lib/log";

/** Countries checkout can really quote (server-side config). Null = unknown (DB unreachable): show all, the quote decides. */
async function shippableCountries(): Promise<string[] | null> {
  try {
    return shippingCoverage(await loadShippingZones(getSql()), marketCountries()).filter((c) => c.shippable).map((c) => c.country);
  } catch (e) {
    logError("checkout: shipping coverage unavailable", e);
    return null;
  }
}

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const { cancelled } = await searchParams;
  const notConnected = checkoutUnavailableReason();
  const unavailable = notConnected ?? (await legalBlocker(getSql()));
  const shippable = notConnected ? null : await shippableCountries();
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <p className="eyebrow text-ink-soft">Secure checkout</p>
      <h1 className="mt-1 font-display text-4xl">Checkout</h1>
      <div className="mt-8">
        <CheckoutForm unavailable={unavailable ?? (shippable && shippable.length === 0 ? "Delivery isn't set up yet, so orders can't be placed. Please check back soon." : null)} cancelled={cancelled === "1"} shippable={shippable} />
      </div>
    </main>
  );
}

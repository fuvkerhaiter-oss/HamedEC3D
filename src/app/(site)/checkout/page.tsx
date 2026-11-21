import type { Metadata } from "next";
import { CheckoutForm } from "@/features/checkout/CheckoutForm";
import { checkoutUnavailableReason, legalBlocker } from "@/lib/checkout/service";
import { getSql } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const { cancelled } = await searchParams;
  const unavailable = checkoutUnavailableReason() ?? (await legalBlocker(getSql()));
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <p className="eyebrow text-ink-soft">Secure checkout</p>
      <h1 className="mt-1 font-display text-4xl">Checkout</h1>
      <div className="mt-8">
        <CheckoutForm unavailable={unavailable} cancelled={cancelled === "1"} />
      </div>
    </main>
  );
}

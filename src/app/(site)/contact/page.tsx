import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm, OrderLookupForm } from "@/features/support/SupportForms";

export const metadata: Metadata = {
  title: "Help & contact",
  description: "Track your order, read our shipping and returns policies, or send a message to the Mega Market team.",
};

const FAQ = [
  { q: "Where is my order?", a: "Use “Track an order” on this page with your email and order number. You also get an email with the tracking number as soon as it ships." },
  { q: "How long does delivery take?", a: "Delivery options and estimated times for your address are shown at checkout before you pay.", link: { href: "/pages/shipping", label: "Shipping policy" } },
  { q: "Can I return something?", a: "Yes. In the EU you have 14 days to change your mind after delivery. Damaged or wrong items are always replaced or refunded.", link: { href: "/pages/returns", label: "Returns & refunds" } },
  { q: "Is paying safe?", a: "Payments are handled by our payment provider on a secure page. We never see or store your full card details." },
  { q: "The 3D store doesn't work on my device", a: "You can always shop the same products, prices and stock in the list view.", link: { href: "/catalog", label: "Open the catalog" } },
];

export default function ContactPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-12">
      <p className="eyebrow text-brand">Help center</p>
      <h1 className="mt-2 font-display text-5xl leading-none">How can we help?</h1>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <section id="track" className="rounded-3xl bg-white/70 p-6 shadow-card">
          <h2 className="font-display text-2xl">Track an order</h2>
          <p className="mt-1 text-sm text-ink-soft">No account needed.</p>
          <div className="mt-5"><OrderLookupForm /></div>
        </section>
        <section id="message" className="rounded-3xl bg-white/70 p-6 shadow-card">
          <h2 className="font-display text-2xl">Send us a message</h2>
          <p className="mt-1 text-sm text-ink-soft">We reply by email, usually within 1–2 business days.</p>
          <div className="mt-5"><ContactForm /></div>
        </section>
      </div>

      <section className="mt-12">
        <h2 className="font-display text-3xl">Frequently asked</h2>
        <div className="mt-5 divide-y divide-line rounded-3xl bg-white/70 shadow-card">
          {FAQ.map((f) => (
            <details key={f.q} className="group p-5">
              <summary className="cursor-pointer list-none font-medium">
                <span className="mr-2 inline-block transition group-open:rotate-45">+</span>{f.q}
              </summary>
              <p className="mt-2 text-ink-soft">
                {f.a} {f.link && <Link href={f.link.href} className="underline">{f.link.label}</Link>}
              </p>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}

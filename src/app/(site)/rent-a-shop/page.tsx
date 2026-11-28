import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RentShop } from "@/features/rentals/RentShop";
import { fmtDay } from "@/features/rentals/format";
import { checkoutUnavailableReason } from "@/lib/checkout/service";
import { LAUNCH_PROMO, promoActive, quoteAll } from "@/lib/rentals/pricing";
import { MarketPrice } from "@/features/rentals/MarketPrice";
import { SHOP_ROOM } from "@/features/store3d/env/shops";
import { loadPublicShops } from "@/lib/rentals/public";
import { countryOptions } from "@/lib/storefront/supporters";

export const dynamic = "force-dynamic"; // live availability
export const metadata: Metadata = {
  title: "Rent a shop in the 3D store",
  description: "Open your brand's own shop inside the WEGO SHIIIP 3D supermarket. Glass-front shop units in the main hall, at an introductory monthly price.",
  alternates: { canonical: "/rent-a-shop" },
};

const STEPS = [
  { title: "Choose a shop and a plan", body: "Pick a free unit and 1, 3 or 12 months. You see the exact total before you pay." },
  { title: "Pay securely", body: "Card payment by Stripe. The shop is held for you for 30 minutes while you pay." },
  { title: "Send us your branding", body: "Reply to your confirmation email with your logo, colours and the products to show." },
  { title: "Your shop opens", body: "We put your brand on the sign and set up your shop. Shoppers walking the 3D store see it." },
];

const FEATURES = [
  { icon: "🏬", title: "A real shop unit", body: "A glass-fronted room 9 m wide and 14 m deep, with lighting, shelving and a feature wall." },
  { icon: "🪧", title: "Your brand on the sign", body: "Your brand name on the illuminated sign above the door, seen by every shopper who walks past." },
  { icon: "🌍", title: "EU + US shoppers", body: "The 3D store runs in the browser on computers and phones, for shoppers in Europe and the United States." },
  { icon: "🛠️", title: "We set it up", body: "Send us your logo and products; our team dresses your shop. Nothing to install." },
];

const TERMS = [
  "Your rental starts the moment your payment is confirmed and lasts the number of months you bought (calendar months).",
  "You pay once for the whole term. Nothing renews automatically: extend from your rental page before it ends to keep your shop.",
  "When you extend early, the new term starts the day after your current one ends, so you never lose days.",
  "The price you pay stays the same for the whole term you bought, even if prices change later.",
  "Your brand name and content must be your own and lawful. We check every brand before it is shown and may decline one; if we decline your brand before your shop opens, you get a full refund.",
  "We may move your shop to an equal or bigger unit if the store layout changes; we'll tell you first.",
  "Bookings are for businesses and sellers. Need to cancel? Contact us and we'll work it out fairly; refunds for unused time are at our discretion unless the law gives you more.",
];

const FAQ = [
  { q: "Can I sell my products from my shop?", a: "Your shop shows your brand to everyone walking the 3D store. Tell us which products you want shown and we'll set up your shop with them; we'll agree the details with you after booking." },
  { q: "When does my shop appear in the 3D store?", a: "Your shop is reserved the moment you pay. Your brand name usually appears on the sign within 2 business days, after a quick check." },
  { q: "What happens when my rental ends?", a: "We email you before it ends. If you don't extend, the shop is released and becomes available to other brands." },
  { q: "Do I get an invoice?", a: "Yes. Add your company name and VAT number when you book and we'll send an invoice with them." },
  { q: "Which currency do I pay in?", a: "Euros or US dollars: switch the region at the top of the page. The price is the same number in both." },
];

export default async function RentAShopPage({ searchParams }: { searchParams: Promise<{ shop?: string; cancelled?: string }> }) {
  const { shop, cancelled } = await searchParams;
  const shops = await loadPublicShops();
  const now = new Date();
  const quotes = { USD: quoteAll("USD", now), EUR: quoteAll("EUR", now) };
  const promo = promoActive(now);
  const free = shops.filter((s) => s.state === "available").length;

  return (
    <main className="w-full">
      <section className="relative overflow-hidden bg-brand-deep text-white">
        <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-amber/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-brand-light/40 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-10 sm:pb-28">
          <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Rent a shop", path: "/rent-a-shop" }]} className="mb-10 text-white/70 [&_*]:!text-white/75" />
          {promo && (
            <p className="inline-flex items-center gap-2 rounded-full bg-amber px-4 py-1.5 text-xs font-extrabold uppercase tracking-[0.14em] text-ink shadow">
              Introductory prices for bookings paid by {fmtDay(LAUNCH_PROMO.endsAt)}
            </p>
          )}
          <h1 className="mt-6 max-w-3xl font-display text-5xl leading-[0.95] sm:text-7xl">
            Open your own shop inside the <span className="text-amber">3D store</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/80">
            Rent a glass-fronted shop unit inside WEGO SHIIIP, the 3D supermarket shoppers walk through in their browser. Your brand, your shop, right where people shop.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <a href="#plans" className="btn-yellow px-7 py-4 text-base">
              From <MarketPrice amounts={{ EUR: quotes.EUR[0]!.amount, USD: quotes.USD[0]!.amount }} /> / month
            </a>
            <Link href="/store" className="rounded-full px-6 py-4 text-base font-semibold text-white ring-1 ring-white/40 transition hover:bg-white hover:text-ink">
              Walk past the shops in 3D →
            </Link>
          </div>
          <dl className="mt-14 grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              { k: `${free} of ${shops.length}`, v: "shops available" },
              { k: `${SHOP_ROOM.width} × ${SHOP_ROOM.depth} m`, v: "virtual shop rooms" },
              { k: "24/7", v: "open in the browser" },
              { k: "€ or $", v: "pay in euros or dollars" },
            ].map((s) => (
              <div key={s.v} className="border-l-2 border-amber pl-4">
                <dt className="font-display text-3xl font-extrabold">{s.k}</dt>
                <dd className="mt-1 text-sm text-white/65">{s.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-5 py-20">
        {cancelled && (
          <p role="status" className="mb-10 rounded-2xl bg-amber/20 px-5 py-4 text-sm">
            Payment cancelled. You have not been charged, and the shop is released after 30 minutes if you don&apos;t book it again.
          </p>
        )}
        <RentShop shops={shops} quotes={quotes} initialShop={shop ?? null} paymentsReady={!checkoutUnavailableReason()} countries={countryOptions()} />

        <section className="mt-28">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow text-brand">What you get</p>
            <h2 className="mt-2 font-display text-4xl leading-tight sm:text-5xl">A storefront people walk past</h2>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-3xl bg-white p-6 ring-1 ring-line">
                <span aria-hidden className="text-3xl">{f.icon}</span>
                <h3 className="mt-4 font-display text-xl">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-28 rounded-[2rem] bg-sand px-6 py-14 sm:px-12">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow text-brand">How it works</p>
            <h2 className="mt-2 font-display text-4xl leading-tight">From booking to open shop</h2>
          </div>
          <ol className="mt-10 grid gap-6 md:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber font-display text-xl font-extrabold text-ink">{i + 1}</span>
                <h3 className="mt-4 font-display text-lg">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-28 grid gap-12 lg:grid-cols-2">
          <section id="terms" className="scroll-mt-28">
            <p className="eyebrow text-brand">The small print, in plain words</p>
            <h2 className="mt-2 font-display text-3xl">Shop rental terms</h2>
            <ul className="mt-6 space-y-3 text-sm leading-relaxed text-ink-soft">
              {TERMS.map((t) => (
                <li key={t} className="flex gap-3"><span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />{t}</li>
              ))}
              {promo && (
                <li className="flex gap-3">
                  <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                  Introductory prices apply to bookings paid by {fmtDay(LAUNCH_PROMO.endsAt)}. Bookings paid after that date are charged the standard price shown under each plan. You keep the price you paid for the whole term you booked.
                </li>
              )}
            </ul>
          </section>
          <section>
            <p className="eyebrow text-brand">Questions</p>
            <h2 className="mt-2 font-display text-3xl">Frequently asked</h2>
            <div className="mt-6 divide-y divide-line rounded-3xl bg-white ring-1 ring-line">
              {FAQ.map((f) => (
                <details key={f.q} className="group px-6 py-4">
                  <summary className="cursor-pointer list-none font-semibold marker:hidden">
                    <span className="flex items-center justify-between gap-4">{f.q}<span aria-hidden className="text-xl text-brand transition group-open:rotate-45">+</span></span>
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.a}</p>
                </details>
              ))}
            </div>
            <p className="mt-5 text-sm text-ink-soft">
              Something else? <Link href="/contact" className="font-semibold underline">Contact us</Link>.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

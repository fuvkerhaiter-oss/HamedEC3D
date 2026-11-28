"use client";

import { useState } from "react";
import { useCart } from "@/features/cart/cart-store";
import type { RentalCurrency, RentalPlanId, RentalQuote } from "@/lib/rentals/pricing";
import { RENTAL_CATEGORIES } from "@/lib/rentals/schema";
import { fmtDay, fmtPrice, type PublicShop } from "./format";

const BASE_PERKS = ["Your brand name on the shop sign", "Branding set up by our team", "Extend any time from your rental page"];

const PLAN_TEXT: Record<RentalPlanId, { name: string; tagline: string; perks: string[] }> = {
  monthly: { name: "Monthly", tagline: "Try the 3D store with no long commitment", perks: ["1 month in your own shop unit", ...BASE_PERKS] },
  quarterly: { name: "Quarterly", tagline: "One season to launch and grow your brand", perks: ["3 months in your own shop unit", ...BASE_PERKS] },
  yearly: { name: "Yearly", tagline: "Your own shop all year at the lowest price", perks: ["12 months in your own shop unit", ...BASE_PERKS] },
};

export function PlanCards({
  quotes,
  selected,
  onSelect,
  actionLabel = "Choose",
}: {
  quotes: RentalQuote[];
  selected: RentalPlanId | null;
  onSelect: (p: RentalPlanId) => void;
  actionLabel?: string;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {quotes.map((q) => {
        const t = PLAN_TEXT[q.plan];
        const featured = q.plan === "yearly";
        const active = selected === q.plan;
        return (
          <button
            key={q.plan}
            type="button"
            onClick={() => onSelect(q.plan)}
            aria-pressed={active}
            className={`group relative flex flex-col rounded-3xl p-7 text-left transition ${
              featured ? "bg-brand-deep text-white shadow-xl" : "bg-white text-ink"
            } ${active ? "ring-4 ring-amber" : featured ? "hover:-translate-y-0.5 hover:shadow-lg" : "ring-1 ring-line hover:-translate-y-0.5 hover:shadow-lg"}`}
          >
            {featured && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber px-4 py-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink shadow">
                Best value
              </span>
            )}
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-xs font-bold uppercase tracking-[0.16em] ${featured ? "text-amber" : "text-brand"}`}>{t.name}</p>
                <p className={`mt-1 text-sm ${featured ? "text-white/70" : "text-ink-soft"}`}>{t.tagline}</p>
              </div>
              {q.promo && (
                <span className="shrink-0 rounded-xl bg-amber px-2.5 py-1 text-[11px] font-extrabold uppercase leading-none tracking-wider text-ink">Intro price</span>
              )}
            </div>

            <div className="mt-6">
              <p className="flex items-end gap-1.5">
                <span className="font-display text-5xl font-extrabold leading-none tracking-tight">{fmtPrice(q.amount, q.currency)}</span>
                <span className={`pb-1 text-sm ${featured ? "text-white/70" : "text-ink-soft"}`}>/ {q.months === 1 ? "month" : q.months === 12 ? "year" : `${q.months} months`}</span>
              </p>
              <p className={`mt-2 text-sm ${featured ? "text-white/80" : "text-ink-soft"}`}>
                {q.months > 1 ? (
                  <>
                    Only <b className={featured ? "text-amber" : "text-ink"}>{fmtPrice(q.perMonth, q.currency)}/month</b>
                    {q.savingVsMonthly > 0 && <> · save {q.savingVsMonthly}% vs monthly</>}
                  </>
                ) : (
                  <>Paid once for the month, no automatic renewal</>
                )}
              </p>
              {q.promo && q.promoEndsAt && (
                <p className={`mt-1 text-xs ${featured ? "text-white/60" : "text-ink-soft"}`}>
                  Standard price for bookings paid after {fmtDay(q.promoEndsAt)}: {fmtPrice(q.regularAmount, q.currency)}
                </p>
              )}
            </div>

            <ul className={`mt-6 space-y-2 text-sm ${featured ? "text-white/90" : "text-ink"}`}>
              {t.perks.map((p) => (
                <li key={p} className="flex gap-2">
                  <span aria-hidden className={featured ? "text-amber" : "text-brand"}>✓</span>
                  {p}
                </li>
              ))}
            </ul>

            <span
              className={`mt-7 inline-flex justify-center rounded-full px-5 py-3 text-sm font-bold transition ${
                active ? "bg-amber text-ink" : featured ? "bg-white text-ink group-hover:bg-amber" : "bg-ink text-white group-hover:bg-brand"
              }`}
            >
              {active ? "Selected ✓" : `${actionLabel} ${t.name.toLowerCase()}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ShopPicker({ shops, selected, onSelect }: { shops: PublicShop[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {shops.map((s) => {
        const free = s.state === "available";
        const active = selected === s.id;
        return (
          <button
            key={s.id}
            type="button"
            disabled={!free}
            onClick={() => onSelect(s.id)}
            aria-pressed={active}
            className={`relative rounded-2xl p-5 text-left transition ${
              !free ? "cursor-not-allowed bg-sand/70 opacity-75" : active ? "bg-white ring-4 ring-amber" : "bg-white ring-1 ring-line hover:-translate-y-0.5 hover:shadow-md"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-2xl font-extrabold">{s.label}</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                  free ? "bg-emerald-100 text-emerald-800" : s.state === "held" ? "bg-amber/30 text-ink" : "bg-ink text-white"
                }`}
              >
                {free ? "Available" : s.state === "held" ? "Being booked" : "Rented"}
              </span>
            </div>
            <p className="mt-2 text-sm text-ink-soft">{s.where}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {s.widthM} m wide · {s.depthM} m deep
            </p>
            <p className="mt-3 text-xs font-medium text-ink-soft">
              {s.state === "rented" ? `${s.brand ? `${s.brand} · ` : ""}free again after ${fmtDay(s.until)}` : s.state === "held" ? "Someone is paying right now. Check back in 30 minutes." : "Glass double doors, lit room, two gondola runs"}
            </p>
          </button>
        );
      })}
    </div>
  );
}

const field = "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[15px] outline-none transition focus:border-transparent focus:ring-2 focus:ring-brand-light";

export function RentShop({
  shops,
  quotes,
  initialShop,
  paymentsReady,
  countries,
}: {
  shops: PublicShop[];
  quotes: Record<RentalCurrency, RentalQuote[]>;
  initialShop?: string | null;
  paymentsReady: boolean;
  /** Built on the server: country names from Intl differ between Node and browsers (hydration). */
  countries: { code: string; name: string }[];
}) {
  const market = useCart((s) => s.market);
  const currency: RentalCurrency = market === "EU" ? "EUR" : "USD";
  const firstFree = shops.find((s) => s.state === "available")?.id ?? null;
  const [shopId, setShopId] = useState<string | null>(
    initialShop && shops.some((s) => s.id === initialShop && s.state === "available") ? initialShop : firstFree,
  );
  const [plan, setPlan] = useState<RentalPlanId>("yearly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = quotes[currency].find((x) => x.plan === plan)!;
  const shop = shops.find((s) => s.id === shopId) ?? null;
  const anyFree = !!firstFree;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!shopId) return setError("Please choose a shop.");
    const fd = new FormData(e.currentTarget);
    const body = {
      shopId,
      plan,
      currency,
      brandName: fd.get("brandName"),
      contactName: fd.get("contactName"),
      email: fd.get("email"),
      phone: fd.get("phone"),
      website: fd.get("website"),
      category: fd.get("category"),
      description: fd.get("description"),
      country: fd.get("country"),
      companyName: fd.get("companyName"),
      vatId: fd.get("vatId"),
      acceptTerms: fd.get("acceptTerms") === "on",
    };
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rentals/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { redirectUrl?: string; error?: string; message?: string };
      if (!res.ok || !json.redirectUrl) {
        setError(json.message && json.error?.startsWith("Please check") ? json.message : json.error ?? "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      window.location.assign(json.redirectUrl);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <section id="plans" className="scroll-mt-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow text-brand">Simple pricing</p>
          <h2 className="mt-2 font-display text-4xl leading-tight sm:text-5xl">Pick your plan</h2>
          <p className="mt-3 text-ink-soft">One payment for the whole term. No set-up fee and no automatic renewal.</p>
        </div>
        <div className="mt-10">
          <PlanCards
            quotes={quotes[currency]}
            selected={plan}
            onSelect={(p) => {
              setPlan(p);
              document.getElementById("book")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        </div>
        <p className="mt-5 text-center text-xs text-ink-soft">
          Prices in {currency === "EUR" ? "euros" : "US dollars"} · switch region at the top of the page.
          {q.promoEndsAt && <> Introductory prices apply to bookings paid by {fmtDay(q.promoEndsAt)}; after that each plan costs its standard price.</>}
        </p>
      </section>

      <section id="book" className="mt-24 scroll-mt-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow text-brand">Book in 2 minutes</p>
          <h2 className="mt-2 font-display text-4xl leading-tight sm:text-5xl">Choose your shop</h2>
          <p className="mt-3 text-ink-soft">Four shop units with glass fronts in the halls of the 3D store, right where shoppers walk.</p>
        </div>
        <div className="mt-10">
          <ShopPicker shops={shops} selected={shopId} onSelect={setShopId} />
        </div>

        {!anyFree ? (
          <div className="mx-auto mt-10 max-w-xl rounded-3xl bg-white p-7 text-center ring-1 ring-line">
            <h3 className="font-display text-2xl">All shops are taken right now</h3>
            <p className="mt-2 text-ink-soft">
              New units open as the store grows. <a href="/contact" className="font-semibold underline">Contact us</a> to join the waiting list.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-10 grid gap-8 lg:grid-cols-[1fr_380px]">
            <div className="rounded-3xl bg-white p-6 ring-1 ring-line sm:p-8">
              <h3 className="font-display text-2xl">About your brand</h3>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">
                  Brand name <span className="text-red-600">*</span>
                  <input name="brandName" required minLength={2} maxLength={60} className={`${field} mt-1.5`} placeholder="Shown on your shop sign" />
                </label>
                <label className="block text-sm font-semibold">
                  Category <span className="text-red-600">*</span>
                  <select name="category" required className={`${field} mt-1.5`} defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {RENTAL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-semibold sm:col-span-2">
                  What do you sell? <span className="text-red-600">*</span>
                  <textarea name="description" required minLength={20} maxLength={1500} rows={4} className={`${field} mt-1.5`} placeholder="Your products, your style, who your customers are…" />
                </label>
                <label className="block text-sm font-semibold sm:col-span-2">
                  Website or social page
                  <input name="website" type="url" maxLength={300} className={`${field} mt-1.5`} placeholder="https://" />
                </label>
              </div>

              <h3 className="mt-9 font-display text-2xl">Your details</h3>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">
                  Full name <span className="text-red-600">*</span>
                  <input name="contactName" required minLength={2} maxLength={120} autoComplete="name" className={`${field} mt-1.5`} />
                </label>
                <label className="block text-sm font-semibold">
                  Email <span className="text-red-600">*</span>
                  <input name="email" type="email" required maxLength={254} autoComplete="email" className={`${field} mt-1.5`} />
                </label>
                <label className="block text-sm font-semibold">
                  Phone
                  <input name="phone" type="tel" maxLength={40} autoComplete="tel" className={`${field} mt-1.5`} />
                </label>
                <label className="block text-sm font-semibold">
                  Country <span className="text-red-600">*</span>
                  <select name="country" required className={`${field} mt-1.5`} defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-semibold">
                  Company name <span className="font-normal text-ink-soft">(for the invoice)</span>
                  <input name="companyName" maxLength={160} autoComplete="organization" className={`${field} mt-1.5`} />
                </label>
                <label className="block text-sm font-semibold">
                  VAT / tax number
                  <input name="vatId" maxLength={40} className={`${field} mt-1.5`} />
                </label>
              </div>
            </div>

            <aside className="lg:sticky lg:top-28 lg:self-start">
              <div className="rounded-3xl bg-brand-deep p-7 text-white shadow-xl">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber">Your booking</p>
                <dl className="mt-5 space-y-3 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-white/65">Shop</dt><dd className="font-semibold">{shop ? shop.label : "Choose a shop"}</dd></div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-white/65">Plan</dt>
                    <dd>
                      <select value={plan} onChange={(e) => setPlan(e.target.value as RentalPlanId)} className="rounded-lg bg-white/10 px-2 py-1 font-semibold text-white outline-none ring-1 ring-white/20 focus:ring-amber" aria-label="Plan">
                        {quotes[currency].map((x) => <option key={x.plan} value={x.plan} className="text-ink">{PLAN_TEXT[x.plan].name} · {x.months} month{x.months > 1 ? "s" : ""}</option>)}
                      </select>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3"><dt className="text-white/65">Starts</dt><dd className="font-semibold">As soon as you pay</dd></div>
                  {q.promo && q.promoEndsAt && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-white/65">Price</dt>
                      <dd className="text-right font-semibold text-amber">Introductory, for bookings paid by {fmtDay(q.promoEndsAt)}</dd>
                    </div>
                  )}
                </dl>
                <div className="mt-5 flex items-end justify-between border-t border-white/15 pt-5">
                  <span className="text-sm text-white/65">Total today</span>
                  <span className="font-display text-4xl font-extrabold">{fmtPrice(q.amount, currency)}</span>
                </div>
                {q.months > 1 && <p className="mt-1 text-right text-xs text-white/60">= {fmtPrice(q.perMonth, currency)} per month</p>}

                <label className="mt-6 flex gap-3 text-sm leading-snug text-white/85">
                  <input name="acceptTerms" type="checkbox" required className="mt-0.5 h-4 w-4 shrink-0 accent-amber" />
                  <span>
                    I accept the <a href="#terms" className="font-semibold underline">shop rental terms</a> and confirm I&apos;m booking for my business.
                  </span>
                </label>

                {error && <p role="alert" className="mt-4 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-100 ring-1 ring-red-400/40">{error}</p>}
                {!paymentsReady && <p className="mt-4 rounded-xl bg-white/10 px-3 py-2 text-xs text-white/80">Online payment isn&apos;t switched on yet. You can still fill in the form; it will tell you if booking isn&apos;t possible.</p>}

                <button type="submit" disabled={busy || !shopId} className="btn-yellow mt-6 w-full justify-center py-4 text-base disabled:opacity-60">
                  {busy ? "Opening secure payment…" : `Rent ${shop?.label ?? "shop"} · ${fmtPrice(q.amount, currency)}`}
                </button>
                <p className="mt-3 text-center text-xs text-white/55">Secure payment by Stripe. The shop is held for you for 30 minutes while you pay.</p>
              </div>
            </aside>
          </form>
        )}
      </section>
    </>
  );
}

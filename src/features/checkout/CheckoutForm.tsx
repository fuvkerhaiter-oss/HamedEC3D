"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { PricedCart } from "@/lib/cart/pricing";
import { EU_COUNTRIES, MARKETS, type MarketId } from "@/lib/markets";
import { formatMoney, type Money } from "@/lib/money";
import { US_STATES } from "@/lib/shipping/address";
import type { ShippingOption } from "@/lib/shipping/quote";
import { useCart } from "@/features/cart/cart-store";
import { useAuthStore } from "@/features/auth/auth-store";

const FIELD = "mt-1 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-ink outline-none transition focus:border-ink focus:ring-2 focus:ring-amber/40";
const LABEL = "block text-sm font-medium";

const noopSubscribe = () => () => {};

interface Quote { cart: PricedCart; options: ShippingOption[]; selectedMethodId: string }

function countryNames(): { code: string; name: string }[] {
  const dn = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
  return [...EU_COUNTRIES, "US"].map((code) => ({ code, name: dn?.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name));
}

/** One idempotency key per cart content: resubmitting (double click, back from the payment page) reuses the same order. */
function checkoutKey(cartKey: string): string {
  try {
    const saved = JSON.parse(sessionStorage.getItem("mm.checkoutKey") ?? "null") as { cartKey: string; key: string } | null;
    if (saved?.cartKey === cartKey) return saved.key;
    const key = crypto.randomUUID();
    sessionStorage.setItem("mm.checkoutKey", JSON.stringify({ cartKey, key }));
    return key;
  } catch {
    return crypto.randomUUID();
  }
}

export function CheckoutForm({ unavailable, cancelled }: { unavailable: string | null; cancelled: boolean }) {
  const user = useAuthStore((s) => s.user);
  const lines = useCart((s) => s.lines);
  const cartMarket = useCart((s) => s.market);
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false); // cart lives in localStorage
  const countries = useMemo(() => countryNames(), []);
  const [country, setCountry] = useState(cartMarket === "US" ? "US" : "IT");
  const [region, setRegion] = useState("");
  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | undefined>();
  const [methodId, setMethodId] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [billingSame, setBillingSame] = useState(true);
  const [billCountry, setBillCountry] = useState(cartMarket === "US" ? "US" : "IT");
  const [billRegion, setBillRegion] = useState("");


  const market: MarketId = country === "US" ? "US" : "EU";
  const locale = MARKETS[market].locale;
  const fmt = (m: Money) => formatMoney(m, locale);

  // Keep the header currency switch in line with the destination.
  useEffect(() => {
    if (hydrated && cartMarket !== market) useCart.getState().setMarket(market);
  }, [hydrated, market, cartMarket]);

  const quoteKey = JSON.stringify({ lines, country, region: region || undefined, couponCode: appliedCoupon, shippingMethodId: methodId });
  const loadingQuote = hydrated && lines.length > 0 && !unavailable && doneKey !== quoteKey;

  useEffect(() => {
    if (!hydrated || lines.length === 0 || unavailable) return;
    const ctrl = new AbortController();
    fetch("/api/checkout/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: quoteKey, signal: ctrl.signal })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) {
          // A rejected discount code shouldn't block checkout: drop it and re-quote without it.
          if (appliedCoupon && r.status === 422) {
            setCouponError(json.error ?? "This code can't be used.");
            setAppliedCoupon(undefined);
            return;
          }
          setQuote(null);
          setQuoteError(json.error ?? "Could not calculate your total.");
        } else {
          setQuote(json as Quote);
          setQuoteError(null);
          if (json.selectedMethodId !== methodId) setMethodId(json.selectedMethodId);
        }
        setDoneKey(quoteKey);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setQuoteError("Network problem. Check your connection and try again.");
        setDoneKey(quoteKey);
      });
    return () => ctrl.abort();
  }, [hydrated, lines.length, quoteKey, appliedCoupon, methodId, unavailable]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || !quote) return;
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines,
          email: get("email"),
          shipTo: {
            fullName: get("fullName"), line1: get("line1"), line2: get("line2"), city: get("city"),
            region: region || undefined, postalCode: get("postalCode"), country, phone: get("phone"),
          },
          billTo: billingSame ? undefined : {
            fullName: get("b_fullName"), line1: get("b_line1"), line2: get("b_line2"), city: get("b_city"),
            region: billRegion || undefined, postalCode: get("b_postalCode"), country: billCountry,
          },
          shippingMethodId: methodId,
          couponCode: appliedCoupon,
          customerNote: get("note"),
          idempotencyKey: checkoutKey(JSON.stringify({ lines, country, appliedCoupon, methodId })),
          acceptTerms: f.get("terms") === "on",
        }),
      });
      const json = await r.json();
      if (!r.ok || !json.redirectUrl) throw new Error(json.error ?? "Something went wrong. You have not been charged.");
      window.location.assign(json.redirectUrl);
    } catch (err) {
      setSubmitError((err as Error).message);
      setSubmitting(false);
    }
  }

  if (!hydrated) return <div className="h-96" aria-busy />;

  if (lines.length === 0) {
    return (
      <div className="rounded-3xl bg-white/70 p-10 text-center">
        <h2 className="font-display text-2xl">Your cart is empty</h2>
        <p className="mt-2 text-ink-soft">Add a few products first.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/catalog" className="rounded-full bg-ink px-6 py-3 font-medium text-cream">Browse the catalog</Link>
          <Link href="/store" className="rounded-full border border-ink px-6 py-3 font-medium">Enter the 3D store</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-8 lg:grid-cols-[1fr_400px]">
      <div className="space-y-8">
        {cancelled && (
          <p role="status" className="rounded-2xl bg-amber/20 px-4 py-3 text-sm">Payment was cancelled. You have not been charged; your cart is still here.</p>
        )}
        {unavailable && (
          <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">Checkout is temporarily unavailable. {unavailable}</p>
        )}

        <section className="rounded-3xl bg-white/70 p-6 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">Contact</h2>
            {!user && (
              <button
                type="button"
                onClick={() => useAuthStore.getState().openAuth("welcome")}
                className="text-xs font-semibold text-ink underline decoration-amber decoration-2 underline-offset-2 hover:text-amber"
              >
                Sign in to use saved details
              </button>
            )}
          </div>
          <label className="mt-4 block">
            <span className={LABEL}>Email</span>
            <input key={user?.email || "guest"} name="email" type="email" required autoComplete="email" defaultValue={user?.email || ""} className={FIELD} />
            <span className="mt-1 block text-xs text-ink-soft">For your order confirmation and tracking.</span>
          </label>
        </section>

        <section className="rounded-3xl bg-white/70 p-6 shadow-card">
          <h2 className="font-display text-xl">Delivery address</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className={LABEL}>Country</span>
              <select value={country} onChange={(e) => { setCountry(e.target.value); setRegion(""); }} autoComplete="country" className={FIELD}>
                {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </label>
            <label className="sm:col-span-2"><span className={LABEL}>Full name</span><input name="fullName" required minLength={2} autoComplete="name" className={FIELD} /></label>
            <label className="sm:col-span-2"><span className={LABEL}>Address</span><input name="line1" required minLength={3} autoComplete="address-line1" className={FIELD} /></label>
            <label className="sm:col-span-2"><span className={LABEL}>Apartment, suite, etc. <span className="font-normal text-ink-soft">(optional)</span></span><input name="line2" autoComplete="address-line2" className={FIELD} /></label>
            <label><span className={LABEL}>Postal code</span><input name="postalCode" required autoComplete="postal-code" className={FIELD} /></label>
            <label><span className={LABEL}>City</span><input name="city" required autoComplete="address-level2" className={FIELD} /></label>
            {country === "US" && (
              <label>
                <span className={LABEL}>State</span>
                <select value={region} onChange={(e) => setRegion(e.target.value)} required autoComplete="address-level1" className={FIELD}>
                  <option value="">Select…</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            )}
            <label className={country === "US" ? "" : "sm:col-span-2"}><span className={LABEL}>Phone <span className="font-normal text-ink-soft">(for the courier, optional)</span></span><input name="phone" type="tel" autoComplete="tel" className={FIELD} /></label>
          </div>
        </section>

        <section className="rounded-3xl bg-white/70 p-6 shadow-card">
          <h2 className="font-display text-xl">Billing address</h2>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={billingSame} onChange={(e) => setBillingSame(e.target.checked)} className="h-4 w-4" />
            Same as delivery address
          </label>
          {!billingSame && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className={LABEL}>Country</span>
                <select value={billCountry} onChange={(e) => { setBillCountry(e.target.value); setBillRegion(""); }} autoComplete="billing country" className={FIELD}>
                  {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </label>
              <label className="sm:col-span-2"><span className={LABEL}>Full name</span><input name="b_fullName" required minLength={2} autoComplete="billing name" className={FIELD} /></label>
              <label className="sm:col-span-2"><span className={LABEL}>Address</span><input name="b_line1" required minLength={3} autoComplete="billing address-line1" className={FIELD} /></label>
              <label className="sm:col-span-2"><span className={LABEL}>Apartment, suite, etc. <span className="font-normal text-ink-soft">(optional)</span></span><input name="b_line2" autoComplete="billing address-line2" className={FIELD} /></label>
              <label><span className={LABEL}>Postal code</span><input name="b_postalCode" required autoComplete="billing postal-code" className={FIELD} /></label>
              <label><span className={LABEL}>City</span><input name="b_city" required autoComplete="billing address-level2" className={FIELD} /></label>
              {billCountry === "US" && (
                <label>
                  <span className={LABEL}>State</span>
                  <select value={billRegion} onChange={(e) => setBillRegion(e.target.value)} required autoComplete="billing address-level1" className={FIELD}>
                    <option value="">Select…</option>
                    {US_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
        </section>

        <section className="rounded-3xl bg-white/70 p-6 shadow-card">
          <h2 className="font-display text-xl">Shipping method</h2>
          {quote?.options.length ? (
            <div className="mt-4 space-y-2" role="radiogroup">
              {quote.options.map((o) => (
                <label key={o.methodId} className={`flex cursor-pointer items-center justify-between gap-4 rounded-xl border px-4 py-3 transition ${methodId === o.methodId ? "border-ink bg-sand/40" : "border-line"}`}>
                  <span className="flex items-center gap-3">
                    <input type="radio" name="shipping" checked={methodId === o.methodId} onChange={() => setMethodId(o.methodId)} />
                    <span>
                      <span className="font-medium">{o.name}</span>
                      {o.minDays != null && o.maxDays != null && <span className="block text-xs text-ink-soft">Estimated {o.minDays}–{o.maxDays} business days after dispatch (estimate, not guaranteed)</span>}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">{o.isFree ? "Free" : fmt(o.amount)}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-soft">{loadingQuote ? "Calculating…" : "Choose your country to see delivery options."}</p>
          )}
        </section>

        <section className="rounded-3xl bg-white/70 p-6 shadow-card">
          <label className="block">
            <span className={LABEL}>Note for your order <span className="font-normal text-ink-soft">(optional)</span></span>
            <textarea name="note" maxLength={1000} rows={2} className={FIELD} />
          </label>
        </section>
      </div>

      <aside className="h-fit space-y-4 rounded-3xl bg-white/80 p-6 shadow-card lg:sticky lg:top-24">
        <h2 className="font-display text-xl">Order summary</h2>
        {quote ? (
          <ul className="divide-y divide-line text-sm">
            {quote.cart.lines.map((l) => (
              <li key={l.variantId} className="flex justify-between gap-3 py-2">
                <span>{l.quantity} × {l.productName}{l.variantName && l.variantName !== "Default" ? ` · ${l.variantName}` : ""}</span>
                <span className="tabular-nums">{fmt(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">{loadingQuote ? "Calculating your total…" : `${lines.length} item(s)`}</p>
        )}

        <div className="flex gap-2">
          <input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="Discount code" maxLength={40} aria-label="Discount code" className={`${FIELD} mt-0`} />
          <button type="button" onClick={() => { setCouponError(null); setAppliedCoupon(coupon.trim() || undefined); }} className="shrink-0 rounded-xl border border-ink px-4 text-sm font-medium">Apply</button>
        </div>
        {couponError && <p role="alert" className="text-xs text-red-700">{couponError}</p>}
        {appliedCoupon && quote && quote.cart.discount.amount > 0 && <p className="text-xs text-emerald-700">Code {appliedCoupon} applied.</p>}

        {quote && (
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{fmt(quote.cart.subtotal)}</dd></div>
            {quote.cart.discount.amount > 0 && <div className="flex justify-between text-emerald-700"><dt>Discount</dt><dd className="tabular-nums">−{fmt(quote.cart.discount)}</dd></div>}
            <div className="flex justify-between"><dt>Shipping</dt><dd className="tabular-nums">{quote.cart.shipping.amount === 0 ? "Free" : fmt(quote.cart.shipping)}</dd></div>
            <div className="flex justify-between text-ink-soft"><dt>{quote.cart.taxMode === "inclusive" ? "Incl. VAT" : "Sales tax"}</dt><dd className="tabular-nums">{fmt(quote.cart.tax)}</dd></div>
            <div className="flex items-end justify-between border-t border-line pt-3"><dt className="font-medium">Total</dt><dd className="font-display text-2xl tabular-nums">{fmt(quote.cart.total)}</dd></div>
          </dl>
        )}

        {quoteError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{quoteError}</p>}

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="terms" required className="mt-1" />
          <span>
            I accept the <Link href="/pages/terms" target="_blank" className="underline">Terms of Sale</Link> and have read the{" "}
            <Link href="/pages/privacy" target="_blank" className="underline">Privacy Policy</Link> and{" "}
            <Link href="/pages/returns" target="_blank" className="underline">Returns policy</Link>.
          </span>
        </label>

        {submitError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{submitError}</p>}

        <button
          type="submit"
          disabled={!quote || !!quoteError || loadingQuote || submitting || !!unavailable}
          className="w-full rounded-full bg-ink py-4 font-semibold text-cream transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Opening secure payment…" : quote ? `Pay ${fmt(quote.cart.total)}` : "Pay"}
        </button>
        <p className="text-center text-xs text-ink-soft">🔒 You&apos;ll pay on a secure payment page. Card details never touch our servers.</p>
      </aside>
    </form>
  );
}

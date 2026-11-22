"use client";

import { useEffect } from "react";
import Image from "next/image";
import { canOptimize } from "@/lib/catalog/image";
import { formatMoney } from "@/lib/money";
import { MARKETS } from "@/lib/markets";
import { MAX_LINE_QUANTITY } from "@/lib/cart/pricing";
import { cartCount, useCart } from "./cart-store";
import { usePricedCart } from "./usePricedCart";

const STEP_BTN =
  "flex h-9 w-9 items-center justify-center rounded-full text-lg font-bold transition hover:bg-white active:scale-75 disabled:opacity-30 disabled:hover:bg-transparent";

/** A little personality that grows with the trolley. */
function mood(count: number): string {
  if (count === 0) return "Empty trolley, endless possibilities.";
  if (count <= 2) return "A fine start. The aisles are calling.";
  if (count <= 5) return "Now we're shopping!";
  if (count <= 10) return "Look at you go, trolley pro.";
  return "Legendary haul. The shelves salute you.";
}

/** Warm tile colors for products without a photo (stable per product name). */
const TILE = ["from-amber to-[#ffdf6b]", "from-[#9be0c0] to-[#d7f5e6]", "from-[#ffb4a2] to-[#ffe1d6]", "from-[#b9c6ff] to-[#e3e8ff]", "from-[#f7a8d8] to-[#fde1f1]"];
const tileFor = (name: string) => TILE[([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) >>> 0) % TILE.length] ?? TILE[0];

export function CartDrawer() {
  const open = useCart((s) => s.open);
  const setOpen = useCart((s) => s.setOpen);
  const lines = useCart((s) => s.lines);
  const count = cartCount(lines);
  const market = MARKETS[useCart((s) => s.market)];
  const { setQuantity, remove } = useCart.getState();
  const { status, cart } = usePricedCart(open && lines.length > 0);
  const fmt = (m: Parameters<typeof formatMoney>[0]) => formatMoney(m, market.locale);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  // z-[80]: above the homepage-embedded 3D store (z-[70]) so C / the checkout counter can open it from there.
  return (
    <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="cart-title">
      <button className="vsw-fade-in absolute inset-0 bg-ink/55 backdrop-blur-sm" aria-label="Close cart" onClick={() => setOpen(false)} />
      <aside
        className="vsw-drawer-in vsw-cart-bg relative flex h-full w-full max-w-md flex-col bg-cream shadow-[-24px_0_60px_rgb(0_0_0/0.3)] sm:my-3 sm:mr-3 sm:h-[calc(100%-1.5rem)] sm:overflow-hidden sm:rounded-[2rem] sm:ring-4 sm:ring-amber"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}
      >
        {/* Header: bouncing trolley + count bubble that wiggles whenever the count changes. */}
        <header className="relative flex items-center gap-4 overflow-hidden bg-amber px-5 py-4 text-ink short:py-3 sm:px-6 sm:py-5">
          <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-white/25" />
          <span aria-hidden className="pointer-events-none absolute right-16 -bottom-10 h-20 w-20 rounded-full bg-white/15" />
          <span aria-hidden className="vsw-cart-bob relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white text-3xl shadow-[0_4px_0_rgb(13_15_14/0.15)]">
            🛒
            <span key={count} className="vsw-cart-wiggle absolute -right-2 -top-2 grid h-6 min-w-6 place-items-center rounded-full bg-ink px-1.5 font-mono text-xs font-bold text-amber ring-2 ring-amber">
              {count}
            </span>
          </span>
          <div className="relative min-w-0 flex-1">
            <h2 id="cart-title" className="font-display text-3xl font-extrabold leading-none tracking-tight short:text-2xl">Your trolley</h2>
            <p className="mt-1 truncate text-sm font-medium text-ink/75">{mood(count)}</p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-xl text-amber shadow-[0_3px_0_rgb(0_0_0/0.25)] transition hover:rotate-90 hover:scale-110 active:translate-y-0.5 active:shadow-none"
            aria-label="Close cart"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {lines.length === 0 && (
            <div className="flex flex-col items-center px-4 py-14 text-center">
              <span aria-hidden className="vsw-cart-roll text-7xl">🛒</span>
              <span aria-hidden className="mt-1 h-2 w-24 rounded-full bg-ink/10 blur-[2px]" />
              <p className="mt-6 font-display text-2xl font-bold">Your trolley is feeling lonely</p>
              <p className="mt-2 max-w-xs text-sm text-ink-soft">It rolled all the way here with nothing inside. Grab something from the shelves and give it a purpose.</p>
              <button onClick={() => setOpen(false)} className="mt-6 rounded-full bg-ink px-6 py-3 font-semibold text-amber shadow-[0_4px_0_var(--color-amber)] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none">
                Back to the aisles
              </button>
            </div>
          )}

          {lines.length > 0 && status === "loading" && !cart && (
            <ul aria-label="Checking prices and stock" className="space-y-3">
              {Array.from({ length: Math.min(3, lines.length) }, (_, i) => (
                <li key={i} className="flex gap-3 rounded-3xl bg-white p-3 ring-1 ring-line">
                  <span className="vsw-shimmer h-16 w-16 shrink-0 rounded-2xl" />
                  <span className="flex-1 space-y-2 py-1">
                    <span className="vsw-shimmer block h-4 w-3/4 rounded-full" />
                    <span className="vsw-shimmer block h-3 w-1/2 rounded-full" />
                    <span className="vsw-shimmer block h-7 w-28 rounded-full" />
                  </span>
                </li>
              ))}
              <li className="eyebrow pt-1 text-center text-ink-soft">Counting your goodies…</li>
            </ul>
          )}
          {status === "error" && (
            <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">Oops, the price scanner hiccuped. Please try again.</p>
          )}

          <ul className="space-y-3">
            {cart?.lines.map((l, i) => (
              <li
                key={l.variantId}
                style={{ animationDelay: `${Math.min(i, 6) * 45}ms` }}
                className="vsw-cart-pop group flex gap-3 rounded-3xl bg-white p-3 ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgb(13_15_14/0.08)] hover:ring-amber"
              >
                {l.imageUrl ? (
                  // 64 px thumbnail: optimized WebP instead of the full-size original
                  <Image src={l.imageUrl} unoptimized={!canOptimize(l.imageUrl)} alt="" width={64} height={64} className="h-16 w-16 shrink-0 rounded-2xl bg-sand object-cover transition group-hover:rotate-[-4deg]" />
                ) : (
                  <span aria-hidden className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br font-display text-2xl font-extrabold text-ink/80 transition group-hover:rotate-[-4deg] ${tileFor(l.productName)}`}>
                    {l.productName.slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold leading-snug">{l.productName}</p>
                    <p className="shrink-0 font-display text-lg font-bold tabular-nums leading-none">{fmt(l.lineTotal)}</p>
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-ink-soft">{l.variantName} · {fmt(l.unitPrice)} each</p>
                  <div className="mt-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center rounded-full bg-sand p-0.5 ring-1 ring-line">
                      <button className={STEP_BTN} aria-label="Decrease quantity"
                        disabled={l.quantity <= 1} onClick={() => setQuantity(l.variantId, l.quantity - 1)}>−</button>
                      <span key={l.quantity} className="vsw-cart-wiggle w-7 text-center font-mono text-sm font-bold tabular-nums" aria-live="polite">{l.quantity}</span>
                      <button className={STEP_BTN} aria-label="Increase quantity"
                        disabled={l.quantity >= MAX_LINE_QUANTITY} onClick={() => setQuantity(l.variantId, l.quantity + 1)}>+</button>
                    </div>
                    <button
                      className="rounded-full px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:bg-red-50 hover:text-red-700"
                      onClick={() => remove(l.variantId)}
                      aria-label={`Remove ${l.productName}`}
                    >
                      Put back on shelf
                    </button>
                  </div>
                </div>
              </li>
            ))}
            {cart?.issues.map((i) => (
              <li key={i.variantId} className="flex items-center justify-between gap-4 rounded-3xl bg-red-50 p-4 text-sm ring-1 ring-red-200">
                <span className="text-red-800">{i.message}</span>
                <button className="shrink-0 font-semibold underline underline-offset-4" onClick={() => remove(i.variantId)}>Remove</button>
              </li>
            ))}
          </ul>
        </div>

        {cart && cart.lines.length > 0 && (
          <footer className="relative border-t-2 border-dashed border-line bg-white px-5 pb-4 pt-5 short:py-3 sm:px-6 sm:pb-6">
            {/* Receipt notch */}
            <span aria-hidden className="absolute -top-3 left-1/2 h-6 w-6 -translate-x-1/2 rounded-full bg-cream" />
            <div className="flex items-end justify-between">
              <span className="eyebrow text-ink-soft">Subtotal</span>
              <span className="font-display text-4xl font-extrabold tabular-nums leading-none short:text-3xl">{fmt(cart.subtotal)}</span>
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              {market.taxMode === "inclusive" ? "Prices include VAT. Shipping calculated at checkout." : "Sales tax and shipping calculated at checkout."}
            </p>
            <a
              href="/checkout"
              onClick={() => setOpen(false)}
              aria-disabled={!cart.purchasable}
              className={`group mt-4 flex w-full items-center justify-center gap-2 rounded-full py-4 text-lg font-extrabold transition short:mt-3 short:py-3 ${
                cart.purchasable
                  ? "bg-amber text-ink shadow-[0_5px_0_var(--color-ink)] hover:-translate-y-0.5 hover:shadow-[0_7px_0_var(--color-ink)] active:translate-y-1 active:shadow-[0_1px_0_var(--color-ink)]"
                  : "pointer-events-none bg-ink/15 text-ink/40"
              }`}
            >
              Checkout
              <span aria-hidden className="inline-block transition group-hover:translate-x-1.5">🛒</span>
            </a>
            <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] font-medium text-ink-soft">
              <li>🔒 Secure payment</li>
              <li>↩ 14-day returns in the EU</li>
            </ul>
          </footer>
        )}
      </aside>
    </div>
  );
}

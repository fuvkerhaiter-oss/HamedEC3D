"use client";

import { useEffect } from "react";
import { formatMoney } from "@/lib/money";
import { MARKETS } from "@/lib/markets";
import { MAX_LINE_QUANTITY } from "@/lib/cart/pricing";
import { cartCount, useCart } from "./cart-store";
import { usePricedCart } from "./usePricedCart";

const STEP_BTN =
  "flex h-10 w-10 items-center justify-center text-lg transition hover:bg-sand active:scale-90 disabled:opacity-30 disabled:hover:bg-transparent";

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

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="cart-title">
      <button className="vsw-fade-in absolute inset-0 bg-ink/55 backdrop-blur-sm" aria-label="Close cart" onClick={() => setOpen(false)} />
      <aside
        className="vsw-drawer-in relative flex h-full w-full max-w-md flex-col bg-cream shadow-[-24px_0_60px_rgb(0_0_0/0.25)]"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 short:py-3 sm:px-6 sm:py-6">
          <div>
            <p className="eyebrow text-brand">
              {count} item{count === 1 ? "" : "s"} · {market.currency}
            </p>
            <h2 id="cart-title" className="mt-1 font-display text-3xl leading-none short:text-2xl">Your cart</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl ring-1 ring-line transition hover:rotate-90 hover:bg-ink hover:text-cream"
            aria-label="Close cart"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-2 sm:px-6">
          {lines.length === 0 && (
            <div className="flex flex-col items-center py-16 text-center">
              <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sand font-display text-3xl text-ink-soft">∅</span>
              <p className="mt-5 font-display text-xl">Your trolley is empty</p>
              <p className="mt-1 text-sm text-ink-soft">Grab something from the shelves.</p>
            </div>
          )}
          {lines.length > 0 && status === "loading" && !cart && (
            <p className="eyebrow py-16 text-center text-ink-soft">Checking prices and stock…</p>
          )}
          {status === "error" && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">Couldn&apos;t load prices. Please try again.</p>}

          <ul className="divide-y divide-line">
            {cart?.lines.map((l) => (
              <li key={l.variantId} className="flex gap-4 py-5">
                {l.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small thumbnail from the product's main image
                  <img src={l.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl bg-sand object-cover" loading="lazy" />
                ) : (
                  <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-sand font-display text-2xl text-ink-soft">
                    {l.productName.slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold leading-snug">{l.productName}</p>
                    <p className="font-display text-lg tabular-nums leading-none">{fmt(l.lineTotal)}</p>
                  </div>
                  <p className="mt-1 font-mono text-xs text-ink-soft">{l.variantName} · {fmt(l.unitPrice)}</p>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex items-center overflow-hidden rounded-full bg-white ring-1 ring-line">
                      <button className={STEP_BTN} aria-label="Decrease quantity"
                        disabled={l.quantity <= 1} onClick={() => setQuantity(l.variantId, l.quantity - 1)}>−</button>
                      <span className="w-7 text-center font-mono text-sm tabular-nums" aria-live="polite">{l.quantity}</span>
                      <button className={STEP_BTN} aria-label="Increase quantity"
                        disabled={l.quantity >= MAX_LINE_QUANTITY} onClick={() => setQuantity(l.variantId, l.quantity + 1)}>+</button>
                    </div>
                    <button className="text-sm font-medium text-ink-soft underline-offset-4 transition hover:text-red-700 hover:underline" onClick={() => remove(l.variantId)}>
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
            {cart?.issues.map((i) => (
              <li key={i.variantId} className="flex items-center justify-between gap-4 py-4 text-sm">
                <span className="text-red-800">{i.message}</span>
                <button className="font-medium underline underline-offset-4" onClick={() => remove(i.variantId)}>Remove</button>
              </li>
            ))}
          </ul>
        </div>

        {cart && cart.lines.length > 0 && (
          <footer className="border-t border-line bg-white/60 px-5 py-4 short:py-3 sm:px-6 sm:py-6">
            <div className="flex items-end justify-between">
              <span className="eyebrow text-ink-soft">Subtotal</span>
              <span className="font-display text-3xl tabular-nums leading-none short:text-2xl">{fmt(cart.subtotal)}</span>
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              {market.taxMode === "inclusive" ? "Prices include VAT. Shipping calculated at checkout." : "Sales tax and shipping calculated at checkout."}
            </p>
            <a
              href="/checkout"
              onClick={() => setOpen(false)}
              aria-disabled={!cart.purchasable}
              className={`mt-4 block w-full rounded-full py-3.5 text-center font-semibold text-cream transition short:mt-3 short:py-3 ${cart.purchasable ? "bg-ink hover:bg-ink-soft" : "pointer-events-none bg-ink/35"}`}
            >
              Checkout
            </a>
            <p className="mt-2 text-center text-xs text-ink-soft">Secure payment · 14-day returns in the EU</p>
          </footer>
        )}
      </aside>
    </div>
  );
}

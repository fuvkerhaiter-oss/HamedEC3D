"use client";

import { Lock, Minus, Plus, RotateCcw, ShoppingCart, Trash2, X } from "lucide-react";
import { useEffect } from "react";
import { track } from "@/features/analytics/track";
import Image from "next/image";
import { canOptimize } from "@/lib/catalog/image";
import { formatMoney } from "@/lib/money";
import { MARKETS } from "@/lib/markets";
import { MAX_LINE_QUANTITY } from "@/lib/cart/pricing";
import { cartCount, useCart } from "./cart-store";
import { usePricedCart } from "./usePricedCart";
import { useAuthStore } from "@/features/auth/auth-store";

const STEP_BTN =
  "flex h-9 w-9 items-center justify-center rounded-lg text-ink transition hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent";

function summary(count: number): string {
  return count === 0 ? "No items yet" : `${count} ${count === 1 ? "item" : "items"}`;
}



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
    if (open) track("cart_view");
  }, [open]);
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
      <button className="vsw-fade-in absolute inset-0 bg-ink/45 backdrop-blur-[2px]" aria-label="Close cart" onClick={() => setOpen(false)} />
      <aside
        className="vsw-drawer-in relative flex h-full w-full max-w-md flex-col bg-white shadow-[-24px_0_64px_-24px_rgb(13_15_14/0.35)] sm:my-3 sm:mr-3 sm:h-[calc(100%-1.5rem)] sm:overflow-hidden sm:rounded-2xl sm:ring-1 sm:ring-ink/5"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}
      >
        <header className="flex items-center gap-3 border-b border-line px-5 py-4 short:py-3 sm:px-6">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber text-ink">
            <ShoppingCart className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="cart-title" className="font-display text-xl leading-tight">Your cart</h2>
            <p key={count} className="text-sm text-ink-soft">{summary(count)}</p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="-mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink-soft transition hover:bg-sand hover:text-ink"
            aria-label="Close cart"
          >
            <X aria-hidden className="h-5 w-5" strokeWidth={2} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {lines.length === 0 && (
            <div className="flex flex-col items-center px-4 py-14 text-center">
              <span aria-hidden className="grid h-16 w-16 place-items-center rounded-2xl bg-sand text-ink-soft"><ShoppingCart className="h-7 w-7" strokeWidth={1.75} /></span>
              <p className="mt-5 font-display text-xl">Your cart is empty</p>
              <p className="mt-1.5 max-w-xs text-sm text-ink-soft">Browse the aisles or the catalog and add products to see them here.</p>
              <button onClick={() => setOpen(false)} className="btn-dark mt-6 px-5 py-2.5 text-sm">
                Continue shopping
              </button>
            </div>
          )}

          {lines.length > 0 && status === "loading" && !cart && (
            <ul aria-label="Checking prices and stock" className="space-y-3">
              {Array.from({ length: Math.min(3, lines.length) }, (_, i) => (
                <li key={i} className="flex gap-3 rounded-xl p-3 ring-1 ring-line">
                  <span className="vsw-shimmer h-16 w-16 shrink-0 rounded-lg" />
                  <span className="flex-1 space-y-2 py-1">
                    <span className="vsw-shimmer block h-4 w-3/4 rounded-full" />
                    <span className="vsw-shimmer block h-3 w-1/2 rounded-full" />
                    <span className="vsw-shimmer block h-7 w-28 rounded-full" />
                  </span>
                </li>
              ))}
              <li className="pt-1 text-center text-xs text-ink-soft">Checking prices and stock…</li>
            </ul>
          )}
          {status === "error" && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">We couldn&apos;t load current prices. Please try again.</p>
          )}

          <ul className="space-y-3">
            {cart?.lines.map((l, i) => (
              <li
                key={l.variantId}
                style={{ animationDelay: `${Math.min(i, 6) * 45}ms` }}
                className="vsw-cart-pop flex gap-3.5 border-b border-line pb-4 last:border-b-0"
              >
                {l.imageUrl ? (
                  // 64 px thumbnail: optimized WebP instead of the full-size original
                  <Image src={l.imageUrl} unoptimized={!canOptimize(l.imageUrl)} alt="" width={64} height={64} className="h-20 w-20 shrink-0 rounded-lg bg-sand object-cover ring-1 ring-line" />
                ) : (
                  <span aria-hidden className={`grid h-20 w-20 shrink-0 place-items-center rounded-lg font-display text-2xl text-ink-soft bg-sand ring-1 ring-line`}>
                    {l.productName.slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold leading-snug">{l.productName}</p>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{fmt(l.lineTotal)}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-soft">{l.variantName} · {fmt(l.unitPrice)} each</p>
                  <div className="mt-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center rounded-lg bg-sand p-0.5 ring-1 ring-line">
                      <button className={STEP_BTN} aria-label="Decrease quantity"
                        disabled={l.quantity <= 1} onClick={() => setQuantity(l.variantId, l.quantity - 1)}><Minus aria-hidden className="h-3.5 w-3.5" strokeWidth={2.25} /></button>
                      <span key={l.quantity} className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">{l.quantity}</span>
                      <button className={STEP_BTN} aria-label="Increase quantity"
                        disabled={l.quantity >= MAX_LINE_QUANTITY} onClick={() => setQuantity(l.variantId, l.quantity + 1)}><Plus aria-hidden className="h-3.5 w-3.5" strokeWidth={2.25} /></button>
                    </div>
                    <button
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-soft transition hover:bg-red-50 hover:text-red-700"
                      onClick={() => remove(l.variantId)}
                      aria-label={`Remove ${l.productName}`}
                    >
                      <Trash2 aria-hidden className="h-3.5 w-3.5" strokeWidth={2} /> Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
            {cart?.issues.map((i) => (
              <li key={i.variantId} className="flex items-center justify-between gap-4 rounded-xl bg-red-50 p-3.5 text-sm ring-1 ring-red-200">
                <span className="text-red-800">{i.message}</span>
                <button className="shrink-0 font-semibold underline underline-offset-4" onClick={() => remove(i.variantId)}>Remove</button>
              </li>
            ))}
          </ul>
        </div>

        {cart && cart.lines.length > 0 && (
          <footer className="border-t border-line bg-cream px-5 pb-4 pt-4 short:py-3 sm:px-6 sm:pb-6">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-ink">Subtotal</span>
              <span className="font-display text-2xl tabular-nums">{fmt(cart.subtotal)}</span>
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              {market.taxMode === "inclusive" ? "Prices include VAT. Shipping calculated at checkout." : "Sales tax and shipping calculated at checkout."}
            </p>
            {!useAuthStore.getState().user && (
              <div className="mt-3 flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-line">
                <span className="text-ink-soft">Have an account?</span>
                <button
                  type="button"
                  onClick={() => { setOpen(false); useAuthStore.getState().openAuth("welcome"); }}
                  className="font-semibold text-ink underline underline-offset-2 hover:text-brand"
                >
                  Sign in to save your cart
                </button>
              </div>
            )}
            <a
              href="/checkout"
              onClick={() => setOpen(false)}
              aria-disabled={!cart.purchasable}
              className={`mt-4 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-base font-semibold transition short:mt-3 short:py-3 ${
                cart.purchasable
                  ? "bg-amber text-ink hover:bg-amber-deep active:translate-y-px"
                  : "pointer-events-none bg-ink/15 text-ink/40"
              }`}
            >
              <Lock aria-hidden className="h-4 w-4" strokeWidth={2} />
              Go to checkout
            </a>
            <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] font-medium text-ink-soft">
              <li className="inline-flex items-center gap-1"><Lock aria-hidden className="h-3 w-3" strokeWidth={2} /> Secure payment</li>
              <li className="inline-flex items-center gap-1"><RotateCcw aria-hidden className="h-3 w-3" strokeWidth={2} /> 14-day returns in the EU</li>
            </ul>
          </footer>
        )}
      </aside>
    </div>
  );
}

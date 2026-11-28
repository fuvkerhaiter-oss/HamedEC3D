"use client";
/** Product page body: image gallery (main image first, admin-defined order) + options + add to cart. */
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { track } from "@/features/analytics/track";
import { useCart } from "@/features/cart/cart-store";
import { canOptimize } from "@/lib/catalog/image";
import { priceIn, stockStatus, type Product } from "@/lib/catalog/types";
import { MARKETS } from "@/lib/markets";
import { formatMoney } from "@/lib/money";

const STOCK_LABEL = { in_stock: "In stock", low_stock: "Low stock", out_of_stock: "Out of stock" } as const;

export function ProductDetail({ product, categoryName }: { product: Product; categoryName?: string }) {
  const gallery = product.gallery ?? (product.imageUrl ? [{ url: product.imageUrl, alt: product.name, width: null, height: null }] : []);
  const [active, setActive] = useState(0);
  const [variantId, setVariantId] = useState(product.variants[0]?.id ?? "");
  const [added, setAdded] = useState(false);
  const market = MARKETS[useCart((s) => s.market)];
  const add = useCart((s) => s.add);
  const openCart = useCart((s) => s.setOpen);
  const buyRef = useRef<HTMLButtonElement>(null);
  // Phones: the sticky buy bar shows whenever the main "Add to cart" button is off screen (below the fold or scrolled past).
  const [buyHidden, setBuyHidden] = useState(false);
  useEffect(() => {
    const el = buyRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setBuyHidden(!e!.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const variant = product.variants.find((v) => v.id === variantId);
  const price = variant ? priceIn(variant, market.currency) : null;
  const stock = variant ? stockStatus(variant) : "out_of_stock";
  const current = gallery[Math.min(active, gallery.length - 1)];
  const canBuy = Boolean(variant && price && stock !== "out_of_stock");
  const addToCart = () => {
    if (!variant) return;
    add(variant.id);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  useEffect(() => {
    track("product_view", { product: product.slug, category: categoryName });
  }, [product.slug, categoryName]);

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div>
        <div className="relative aspect-square overflow-hidden rounded-3xl bg-sand ring-1 ring-line">
          {current ? (
            <Image key={current.url} src={current.url} unoptimized={!canOptimize(current.url)} alt={current.alt || product.name} fill priority sizes="(min-width: 1200px) 580px, (min-width: 1024px) 50vw, 100vw" className="object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-center">
              <span aria-hidden className="font-display text-8xl text-brand/80">{product.name.slice(0, 1)}</span>
              <span className="eyebrow absolute bottom-6 text-ink/75">No photo yet</span>
            </div>
          )}
          {product.isMock && <span className="eyebrow absolute left-3 top-3 rounded-md bg-ink/85 px-2 py-1 !text-[9px] text-cream">Sample product</span>}
        </div>
        {gallery.length > 1 && (
          <ul className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Product photos">
            {gallery.map((g, i) => (
              <li key={g.url}>
                <button type="button" onClick={() => setActive(i)} aria-label={`Show photo ${i + 1}`} aria-current={i === active}
                  className={`relative block h-20 w-20 overflow-hidden rounded-xl ring-2 transition ${i === active ? "ring-amber" : "ring-transparent hover:ring-ink/20"}`}>
                  <Image src={g.url} unoptimized={!canOptimize(g.url)} alt="" fill sizes="80px" className="object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        {categoryName && <p className="inline-block rounded-full bg-brand px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">{categoryName}</p>}
        <h1 className="mt-3 font-display text-3xl leading-tight sm:mt-4 sm:text-5xl">{product.name}</h1>
        <p className="mt-5 border-t border-line pt-5 font-display text-3xl tabular-nums sm:mt-6 sm:pt-6 sm:text-4xl">{price ? formatMoney(price, market.locale) : <span className="text-lg text-ink-soft">Not sold in this region</span>}</p>
        <p className="mt-1 text-xs text-ink-soft">{market.taxMode === "inclusive" ? "VAT included" : "Before sales tax"} · {STOCK_LABEL[stock]}</p>
        {product.variants.length > 1 && (
          <label className="mt-6 block text-sm">
            <span className="font-medium">Option</span>
            <select value={variantId} onChange={(e) => setVariantId(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-base">
              {product.variants.map((v) => <option key={v.id} value={v.id}>{v.name}{v.stockQuantity <= 0 ? " (out of stock)" : ""}</option>)}
            </select>
          </label>
        )}
        <button
          ref={buyRef}
          type="button"
          disabled={!canBuy}
          onClick={addToCart}
          className={`mt-6 min-h-12 w-full rounded-full py-3.5 font-semibold transition disabled:cursor-not-allowed disabled:bg-sand disabled:text-ink-soft sm:w-auto sm:px-10 ${added ? "bg-brand text-white" : "bg-amber text-ink shadow-[inset_0_-2px_0_rgb(0_0_0/0.12)] hover:bg-ink hover:text-white"}`}
        >
          {added ? "Added ✓" : "Add to cart"}
        </button>
        {added && (
          <button type="button" onClick={() => openCart(true)} className="mt-3 w-full rounded-full py-3 text-sm font-semibold underline-offset-4 ring-1 ring-ink/15 hover:underline sm:ml-3 sm:mt-6 sm:w-auto sm:px-6">
            View cart & checkout
          </button>
        )}
        <span className="sr-only" aria-live="polite">{added ? `${product.name} added to cart` : ""}</span>
        <ul className="mt-6 grid gap-2 text-sm text-ink-soft sm:grid-cols-3">
          {["Delivery options & cost shown at checkout", "Secure payment by Stripe", "14-day right of withdrawal (EU)"].map((t) => (
            <li key={t} className="flex items-center gap-2 rounded-xl bg-sand/70 px-3 py-2.5">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              {t}
            </li>
          ))}
        </ul>
        {product.description && <p className="mt-8 whitespace-pre-line leading-relaxed text-ink-soft">{product.description}</p>}
      </div>

      {/* Phones/tablets: price + Add to cart stay reachable with the thumb while reading the page. */}
      <div
        aria-hidden={!buyHidden}
        className={`fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 pt-3 shadow-[0_-8px_24px_rgb(17_21_19/0.08)] backdrop-blur transition-transform duration-200 lg:hidden ${buyHidden ? "translate-y-0" : "pointer-events-none translate-y-full"}`}
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-ink-soft">{product.name}</p>
            <p className="font-display text-xl tabular-nums leading-tight">{price ? formatMoney(price, market.locale) : "—"}</p>
          </div>
          <button
            type="button"
            tabIndex={buyHidden ? 0 : -1}
            disabled={!canBuy}
            onClick={added ? () => openCart(true) : addToCart}
            className={`min-h-12 shrink-0 rounded-full px-6 font-semibold transition disabled:bg-sand disabled:text-ink-soft ${added ? "bg-brand text-white" : "bg-amber text-ink"}`}
          >
            {stock === "out_of_stock" ? "Out of stock" : added ? "View cart" : "Add to cart"}
          </button>
        </div>
      </div>
      <div aria-hidden className="h-16 lg:hidden" />{/* room for the sticky bar at the end of the page */}
    </div>
  );
}

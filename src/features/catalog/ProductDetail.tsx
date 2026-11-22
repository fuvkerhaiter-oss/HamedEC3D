"use client";
/** Product page body: image gallery (main image first, admin-defined order) + options + add to cart. */
import Image from "next/image";
import { useState } from "react";
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
  const variant = product.variants.find((v) => v.id === variantId);
  const price = variant ? priceIn(variant, market.currency) : null;
  const stock = variant ? stockStatus(variant) : "out_of_stock";
  const current = gallery[Math.min(active, gallery.length - 1)];

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div>
        <div className="relative aspect-square overflow-hidden rounded-3xl bg-sand ring-1 ring-line">
          {current ? (
            <Image key={current.url} src={current.url} unoptimized={!canOptimize(current.url)} alt={current.alt || product.name} fill priority sizes="(min-width: 1200px) 580px, (min-width: 1024px) 50vw, 100vw" className="object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-center">
              <span aria-hidden className="font-display text-8xl text-white/90">{product.name.slice(0, 1)}</span>
              <span className="eyebrow absolute bottom-6 text-ink/55">No photo yet</span>
            </div>
          )}
          {product.isMock && <span className="eyebrow absolute left-3 top-3 rounded-md bg-ink/85 px-2 py-1 !text-[9px] text-cream">Sample product</span>}
        </div>
        {gallery.length > 1 && (
          <ul className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Product photos">
            {gallery.map((g, i) => (
              <li key={g.url}>
                <button type="button" onClick={() => setActive(i)} aria-label={`Show photo ${i + 1}`} aria-current={i === active}
                  className={`relative block h-20 w-20 overflow-hidden rounded-xl ring-2 transition ${i === active ? "ring-ink" : "ring-transparent hover:ring-line"}`}>
                  <Image src={g.url} unoptimized={!canOptimize(g.url)} alt="" fill sizes="80px" className="object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        {categoryName && <p className="eyebrow text-brand">{categoryName}</p>}
        <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">{product.name}</h1>
        <p className="mt-5 font-display text-3xl tabular-nums">{price ? formatMoney(price, market.locale) : <span className="text-lg text-ink-soft">Not sold in this region</span>}</p>
        <p className="mt-1 text-xs text-ink-soft">{market.taxMode === "inclusive" ? "VAT included" : "Before sales tax"} · {STOCK_LABEL[stock]}</p>
        {product.variants.length > 1 && (
          <label className="mt-6 block text-sm">
            <span className="font-medium">Option</span>
            <select value={variantId} onChange={(e) => setVariantId(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2.5">
              {product.variants.map((v) => <option key={v.id} value={v.id}>{v.name}{v.stockQuantity <= 0 ? " (out of stock)" : ""}</option>)}
            </select>
          </label>
        )}
        <button
          type="button"
          disabled={!variant || !price || stock === "out_of_stock"}
          onClick={() => {
            if (!variant) return;
            add(variant.id);
            setAdded(true);
            setTimeout(() => setAdded(false), 1500);
          }}
          className={`mt-6 w-full rounded-full py-3.5 font-semibold transition disabled:cursor-not-allowed disabled:bg-sand disabled:text-ink-soft sm:w-auto sm:px-10 ${added ? "bg-brand text-cream" : "bg-amber text-ink hover:bg-ink hover:text-cream"}`}
        >
          {added ? "Added ✓" : "Add to cart"}
        </button>
        <span className="sr-only" aria-live="polite">{added ? `${product.name} added to cart` : ""}</span>
        {product.description && <p className="mt-8 whitespace-pre-line leading-relaxed text-ink-soft">{product.description}</p>}
      </div>
    </div>
  );
}

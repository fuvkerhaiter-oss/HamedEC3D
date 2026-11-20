"use client";

import Image from "next/image";
import Link from "next/link";
import { canOptimize } from "@/lib/catalog/image";
import { useState } from "react";
import { useCart } from "@/features/cart/cart-store";
import { categoryColor } from "@/lib/catalog/colors";
import { priceIn, stockStatus, type Product } from "@/lib/catalog/types";
import { MARKETS } from "@/lib/markets";
import { formatMoney } from "@/lib/money";

const STOCK_LABEL = { in_stock: "In stock", low_stock: "Low stock", out_of_stock: "Out of stock" } as const;
const STOCK_TONE = { in_stock: "text-brand", low_stock: "text-amber-700", out_of_stock: "text-red-700" } as const;

/**
 * Catalog card. Prices shown are the server-loaded catalog prices for the shopper's market;
 * the cart only stores variant ids and is re-priced by /api/cart/price.
 */
export function ProductCard({ product, categorySlug, categoryName, priority = false }: { product: Product; categorySlug?: string; categoryName?: string; priority?: boolean }) {
  const [variantId, setVariantId] = useState(product.variants[0]?.id ?? "");
  const [added, setAdded] = useState(false);
  const market = MARKETS[useCart((s) => s.market)];
  const add = useCart((s) => s.add);
  const variant = product.variants.find((v) => v.id === variantId);
  const price = variant ? priceIn(variant, market.currency) : null;
  const stock = variant ? stockStatus(variant) : "out_of_stock";
  const optionCount = product.variants.length;
  const color = categoryColor(categorySlug);
  const titleId = `pc-${product.id}`;

  return (
    <article aria-labelledby={titleId} className="vsw-card group flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-line">
      <div className="relative aspect-square overflow-hidden" style={{ background: `linear-gradient(140deg, ${color}26, ${color}8c)` }}>
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            unoptimized={!canOptimize(product.imageUrl)}
            alt={product.name}
            fill
            priority={priority}
            sizes="(min-width: 1024px) 22vw, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1">
            <span aria-hidden className="font-display text-6xl font-extrabold text-white/90 drop-shadow-sm transition duration-700 group-hover:scale-110 sm:text-7xl">
              {product.name.replace(/^[^A-Za-z]+/, "").slice(0, 1) || product.name.slice(0, 1)}
            </span>
            <span className="eyebrow !text-[9px] text-ink/55">No photo yet</span>
          </div>
        )}
        <Link href={`/catalog/${product.slug}`} className="absolute inset-0" aria-label={`View ${product.name}`} tabIndex={-1} />
        {product.isMock && (
          <span className="eyebrow absolute left-2 top-2 rounded-md bg-ink/85 px-2 py-1 !text-[9px] !tracking-[0.12em] text-cream backdrop-blur">Sample product</span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        {categoryName && <p className="truncate text-[11px] font-medium uppercase tracking-wide text-ink-soft/70">{categoryName}</p>}
        <h3 id={titleId} className="mt-0.5 line-clamp-2 min-h-[2.5em] text-sm font-semibold leading-tight text-ink sm:text-[15px]"><Link href={`/catalog/${product.slug}`} className="hover:underline">{product.name}</Link></h3>

        <p className="mt-2 font-display text-xl tabular-nums leading-none sm:text-2xl">{price ? formatMoney(price, market.locale) : <span className="text-base text-ink-soft">Not sold in this region</span>}</p>
        <p className="mt-1 text-[11px] text-ink-soft/80">{market.taxMode === "inclusive" ? "VAT included" : "Before sales tax"}</p>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={`inline-flex items-center gap-1.5 font-medium ${STOCK_TONE[stock]}`}>
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
            {STOCK_LABEL[stock]}
          </span>
          {optionCount > 1 && <span className="text-ink-soft">{optionCount} options</span>}
        </div>

        <div className="mt-auto pt-3">
          {optionCount > 1 ? (
            <label className="mb-2 block text-xs">
              <span className="sr-only">Option for {product.name}</span>
              <select value={variantId} onChange={(e) => setVariantId(e.target.value)} className="w-full rounded-lg border border-line bg-cream px-2.5 py-2 text-sm font-medium">
                {product.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.stockQuantity <= 0 ? " (out of stock)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            product.variants[0] && <p className="mb-2 truncate rounded-lg bg-cream px-2.5 py-2 text-sm text-ink-soft">{product.variants[0].name}</p>
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
            className={`w-full rounded-full py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-sand disabled:text-ink-soft ${added ? "bg-brand text-cream" : "bg-amber text-ink hover:bg-ink hover:text-cream"}`}
          >
            {added ? "Added ✓" : "Add to cart"}
          </button>
          <span className="sr-only" aria-live="polite">{added ? `${product.name} added to cart` : ""}</span>
        </div>
      </div>
    </article>
  );
}

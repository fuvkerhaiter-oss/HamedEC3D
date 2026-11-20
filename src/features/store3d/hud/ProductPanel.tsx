"use client";

import Image from "next/image";
import { canOptimize } from "@/lib/catalog/image";
import { useEffect, useState } from "react";
import { useCart } from "@/features/cart/cart-store";
import { MAX_LINE_QUANTITY } from "@/lib/cart/pricing";
import { priceIn, stockStatus, type Product } from "@/lib/catalog/types";
import { MARKETS } from "@/lib/markets";
import { formatMoney } from "@/lib/money";

const STOCK = {
  in_stock: { label: "In stock", cls: "text-brand" },
  low_stock: { label: "Only a few left", cls: "text-amber-700" },
  out_of_stock: { label: "Out of stock", cls: "text-red-700" },
} as const;

/** Product details opened from the shelf. Data is the server-loaded catalog; the cart reprices server-side. */
export function ProductPanel({
  product,
  onClose,
  onAdd,
}: {
  product: Product;
  onClose: (resume: boolean) => void;
  /** Puts the item in the trolley (animated) and returns to the aisles. */
  onAdd: (variantId: string, quantity: number) => void;
}) {
  const [variantId, setVariantId] = useState(product.variants[0]?.id ?? "");
  const [qty, setQty] = useState(1);
  const market = MARKETS[useCart((s) => s.market)];
  const setCartOpen = useCart((s) => s.setOpen);

  const variant = product.variants.find((v) => v.id === variantId);
  const price = variant ? priceIn(variant, market.currency) : null;
  const stock = variant ? stockStatus(variant) : "out_of_stock";
  const maxQty = variant ? Math.min(MAX_LINE_QUANTITY, variant.stockQuantity) : 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 flex overflow-y-auto overscroll-contain bg-ink/50 p-3 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="product-title">
      <div className="m-auto grid w-full max-w-3xl overflow-hidden rounded-3xl bg-cream shadow-2xl md:grid-cols-2 short:grid-cols-[2fr_3fr]">
        <div className="relative min-h-44 bg-sand sm:min-h-56 short:min-h-0">
          {product.imageUrl ? (
            <Image src={product.imageUrl} unoptimized={!canOptimize(product.imageUrl)} alt={product.name} fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
          ) : (
            <div className="flex h-full min-h-44 flex-col items-center justify-center gap-2 p-6 text-center text-ink-soft sm:min-h-56">
              <span className="font-display text-6xl text-ink/30" aria-hidden>{product.name.slice(0, 1)}</span>
              <span className="text-sm">Product photo coming soon</span>
            </div>
          )}
          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
            {product.isMock && <span className="rounded-full bg-ink/85 px-2.5 py-1 text-[10px] uppercase tracking-wider text-cream">Sample product</span>}
            {!product.asset.glbUrl && <span className="rounded-full bg-cream/90 px-2.5 py-1 text-[10px] uppercase tracking-wider text-ink">Shelf shows placeholder shape</span>}
          </div>
        </div>

        <div className="flex flex-col gap-3 p-5 sm:gap-4 sm:p-7 short:gap-2 short:p-4">
          <div className="flex items-start justify-between gap-4">
            <h2 id="product-title" className="font-display text-2xl leading-tight sm:text-3xl short:text-2xl">{product.name}</h2>
            <button onClick={() => onClose(false)} className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-ink-soft hover:bg-sand hover:text-ink" aria-label="Close">×</button>
          </div>
          <div>
            <p className="text-2xl font-medium tabular-nums">{price ? formatMoney(price, market.locale) : "Not available in this region"}</p>
            <p className="text-xs text-ink-soft">{market.taxMode === "inclusive" ? "VAT included" : "Plus applicable sales tax"}</p>
          </div>
          <p className="text-ink-soft short:line-clamp-2 short:text-sm">{product.description}</p>

          {product.variants.length > 1 && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Option</legend>
              <div className="flex flex-wrap gap-2">
                {product.variants.map((v) => (
                  <button key={v.id} onClick={() => { setVariantId(v.id); setQty(1); }} aria-pressed={v.id === variantId}
                    className={`rounded-full border px-4 py-2 text-sm ${v.id === variantId ? "border-ink bg-ink text-cream" : "border-sand hover:border-ink"}`}>
                    {v.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <p className={`text-sm ${STOCK[stock].cls}`}>{STOCK[stock].label}</p>

          <div className="mt-auto flex items-center gap-3">
            <div className="flex items-center rounded-full border border-sand">
              <button className="h-11 w-11 disabled:opacity-30" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Decrease quantity">−</button>
              <span className="w-8 text-center tabular-nums" aria-live="polite">{qty}</span>
              <button className="h-11 w-11 disabled:opacity-30" onClick={() => setQty((q) => Math.min(maxQty, q + 1))} disabled={qty >= maxQty} aria-label="Increase quantity">+</button>
            </div>
            <button
              disabled={!variant || !price || stock === "out_of_stock"}
              onClick={() => variant && onAdd(variant.id, qty)}
              className="flex-1 rounded-full bg-ink py-3 font-medium text-cream transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-40"
            >
              Put in trolley
            </button>
          </div>
          <div className="flex justify-between text-sm">
            <button onClick={() => onClose(true)} className="py-1.5 underline">Back to the aisles</button>
            <button onClick={() => { onClose(false); setCartOpen(true); }} className="py-1.5 underline">View cart</button>
          </div>
        </div>
      </div>
    </div>
  );
}

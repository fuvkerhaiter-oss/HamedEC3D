"use client";

import { Hand } from "lucide-react";
import Image from "next/image";
import { canOptimize } from "@/lib/catalog/image";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useCart } from "@/features/cart/cart-store";
import { categoryColor } from "@/lib/catalog/colors";
import { priceIn, stockStatus, type Product } from "@/lib/catalog/types";
import { MARKETS } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { onPeekFrame } from "../peek/PeekTracker";
import type { StoreCatalog } from "../StoreScene";
import { useStoreUi } from "../ui-store";
import { PhotoSlideshow } from "./PhotoSlideshow";
import "./product-peek.css";

/** Look at a product this long before the card opens (sweeping the view across a shelf stays calm). */
const DWELL_MS = 170;
const EXIT_MS = 220;

const STOCK = {
  in_stock: { label: "In stock", cls: "vsw-peek-stock-ok" },
  low_stock: { label: "Only a few left", cls: "vsw-peek-stock-low" },
  out_of_stock: { label: "Out of stock", cls: "vsw-peek-stock-out" },
} as const;

/**
 * "Look to preview": when the crosshair rests on a product, an AR-style callout opens — an anchor ring
 * pinned on the product, a leader line, and a glass card that flips in with depth layers (photo, name,
 * price, stock, options, description). The card tilts with camera motion for a 3D feel.
 * Display only: prices come from the server-loaded catalog, and the cart reprices server-side.
 */
export function ProductPeek({ catalog }: { catalog: StoreCatalog }) {
  const target = useStoreUi((s) => s.target);
  const locked = useStoreUi((s) => s.locked);
  const openProductId = useStoreUi((s) => s.openProductId);
  const inspect = useStoreUi((s) => s.inspect);
  const wanted = locked && !openProductId && !inspect && target?.kind === "product" ? target.productId : null;
  const [shown, setShown] = useState<{ id: string; leaving: boolean } | null>(null);

  useEffect(() => {
    if (wanted) {
      const t = setTimeout(() => setShown({ id: wanted, leaving: false }), DWELL_MS);
      return () => clearTimeout(t);
    }
    const t1 = setTimeout(() => setShown((s) => (s ? { ...s, leaving: true } : s)), 0);
    const t2 = setTimeout(() => setShown((s) => (s?.leaving ? null : s)), EXIT_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [wanted]);

  const product = shown ? catalog.products.find((p) => p.id === shown.id) ?? null : null;
  if (!product || !shown) return null;
  return <PeekCallout key={product.id} product={product} catalog={catalog} leaving={shown.leaving} />;
}

function PeekCallout({ product, catalog, leaving }: { product: Product; catalog: StoreCatalog; leaving: boolean }) {
  const market = MARKETS[useCart((s) => s.market)];
  const touchMode = useStoreUi((s) => s.touchMode);
  const card = useRef<HTMLDivElement>(null);
  const tilt = useRef<HTMLDivElement>(null);
  const wire = useRef<SVGSVGElement>(null);
  const pin = useRef<SVGGElement>(null);
  const line = useRef<SVGLineElement>(null);
  const tip = useRef<SVGCircleElement>(null);

  const info = useMemo(() => {
    const catIndex = catalog.categories.findIndex((c) => c.id === product.categoryId);
    const category = catalog.categories[catIndex];
    const prices = product.variants.map((v) => priceIn(v, market.currency)).filter((m) => m !== null);
    const amounts = prices.map((m) => m.amount);
    const min = prices.find((m) => m.amount === Math.min(...amounts)) ?? null;
    const statuses = product.variants.map((v) => stockStatus(v));
    const stock = statuses.includes("in_stock") ? "in_stock" : statuses.includes("low_stock") ? "low_stock" : "out_of_stock";
    return {
      category: category?.name ?? null,
      color: categoryColor(category?.slug, Math.max(0, catIndex)),
      price: min ? formatMoney(min, market.locale) : null,
      from: new Set(amounts).size > 1,
      stock,
    } as const;
  }, [product, catalog.categories, market]);

  // Follow the product on screen every frame (direct DOM writes; no React renders).
  useEffect(() => {
    onPeekFrame((f) => {
      const svg = wire.current;
      const c = card.current;
      if (!svg || !c) return;
      svg.style.opacity = f.onScreen ? "1" : "0";
      pin.current?.setAttribute("transform", `translate(${f.x.toFixed(1)} ${f.y.toFixed(1)})`);

      // Leader line: from the pin to the nearest point on the card's edge.
      const r = c.getBoundingClientRect();
      const ex = Math.min(Math.max(f.x, r.left + 14), r.right - 14);
      const ey = Math.min(Math.max(f.y, r.top + 14), r.bottom - 14);
      const inside = f.x > r.left && f.x < r.right && f.y > r.top && f.y < r.bottom;
      const l = line.current;
      if (l) {
        l.setAttribute("x1", f.x.toFixed(1));
        l.setAttribute("y1", f.y.toFixed(1));
        l.setAttribute("x2", ex.toFixed(1));
        l.setAttribute("y2", ey.toFixed(1));
        l.style.visibility = inside ? "hidden" : "visible";
      }
      tip.current?.setAttribute("transform", `translate(${ex.toFixed(1)} ${ey.toFixed(1)})`);

      // Parallax tilt: the card lags behind camera turns like a physical panel.
      const ry = Math.max(-14, Math.min(14, f.yawRate * 7));
      const rx = Math.max(-9, Math.min(9, -f.pitchRate * 6));
      tilt.current?.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
      tilt.current?.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
    });
    return () => onPeekFrame(null);
  }, []);

  const gallery = product.gallery ?? [];
  const options = product.variants.map((v) => v.name);
  const stock = STOCK[info.stock];

  return (
    <div className="vsw-peek-root" data-state={leaving ? "out" : "in"} aria-hidden={leaving || undefined}>
      <svg ref={wire} className="vsw-peek-wire" aria-hidden>
        <line ref={line} pathLength={1} className="vsw-peek-line" />
        <circle ref={tip} r={3.5} className="vsw-peek-tip" />
        <g ref={pin}>
          <circle r={7} className="vsw-peek-ring" />
          <circle r={9} className="vsw-peek-ring vsw-peek-ring-2" />
          <circle r={5} className="vsw-peek-dot" />
        </g>
      </svg>

      <div ref={card} className="vsw-peek-place">
        <div className="vsw-peek-flip">
          <div ref={tilt} className="vsw-peek-tilt">
            <article
              className="vsw-peek"
              role="status"
              aria-label={`${product.name}${info.price ? `, ${info.from ? "from " : ""}${info.price}` : ""}`}
              style={{ "--peek-accent": info.color } as CSSProperties}
            >
              <div className="vsw-peek-bg" />
              <div className={`vsw-peek-media${product.imageUrl ? " vsw-peek-media-photo" : ""}`}>
                {gallery.length > 1 ? (
                  <PhotoSlideshow key={product.id} images={gallery} sizes="(max-width: 640px) 110px, 340px" decorative active={!leaving} />
                ) : product.imageUrl ? (
                  <Image src={product.imageUrl} unoptimized={!canOptimize(product.imageUrl)} alt="" fill sizes="(max-width: 640px) 110px, 340px" className="object-contain" />
                ) : (
                  <span className="vsw-peek-initial" aria-hidden>{product.name.slice(0, 1)}</span>
                )}
                <div className="vsw-peek-badges">
                  {product.isMock && <span className="vsw-peek-badge">Sample product</span>}
                  {!product.imageUrl && <span className="vsw-peek-badge vsw-peek-badge-soft">Photo coming soon</span>}
                </div>
              </div>

              <div className="vsw-peek-body">
                {info.category && <p className="vsw-peek-eyebrow" style={{ "--i": 0 } as CSSProperties}>{info.category}</p>}
                <h3 className="vsw-peek-title" style={{ "--i": 1 } as CSSProperties}>{product.name}</h3>
                <div className="vsw-peek-price-row" style={{ "--i": 2 } as CSSProperties}>
                  <span className="vsw-peek-price">
                    {info.price ? (
                      <>
                        {info.from && <small>from </small>}
                        {info.price}
                      </>
                    ) : (
                      "Not sold in this region"
                    )}
                  </span>
                  {info.price && <span className="vsw-peek-tax">{market.taxMode === "inclusive" ? "VAT incl." : "+ sales tax"}</span>}
                </div>
                <div className="vsw-peek-meta" style={{ "--i": 3 } as CSSProperties}>
                  <span className={`vsw-peek-stock ${stock.cls}`}>{stock.label}</span>
                  {options.length > 1 && (
                    <span className="vsw-peek-options">
                      {options.slice(0, 3).map((o) => (
                        <span key={o} className="vsw-peek-chip">{o}</span>
                      ))}
                      {options.length > 3 && <span className="vsw-peek-chip">+{options.length - 3}</span>}
                    </span>
                  )}
                </div>
                <p className="vsw-peek-desc" style={{ "--i": 4 } as CSSProperties}>{product.description}</p>
                <p className="vsw-peek-hint" style={{ "--i": 5 } as CSSProperties}>
                  {touchMode ? <span className="vsw-peek-key inline-flex items-center gap-1">Tap <Hand aria-hidden className="h-3.5 w-3.5" strokeWidth={2} /></span> : <kbd className="vsw-peek-key">E</kbd>}
                  Details &amp; add to trolley
                </p>
              </div>
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}

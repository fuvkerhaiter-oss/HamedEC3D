"use client";

import { ArrowUpRight } from "lucide-react";
import { useEffect } from "react";
import { fmtPrice, type PublicShop } from "@/features/rentals/format";

/**
 * In-store panel for a shop renter's product: photo, price, description, the brand, and "Buy" → the renter's own
 * payment page (through /api/shop-products/[id]/buy, which counts the click). Opening it counts a view.
 */
export function TenantProductPanel({ shopId, productId, shops, onClose }: { shopId: string; productId: string; shops?: PublicShop[]; onClose: (resume: boolean) => void }) {
  const store = shops?.find((s) => s.id === shopId)?.storefront ?? null;
  const p = store?.products.find((x) => x.id === productId) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (p) void fetch(`/api/shop-products/${p.id}/view`, { method: "POST", keepalive: true }).catch(() => {});
  }, [p]);

  if (!store || !p) return null;
  const accent = store.accent.toLowerCase() === "#ffffff" ? "#f7c416" : store.accent;
  return (
    <div className="fixed inset-0 z-30 flex overflow-y-auto overscroll-contain bg-ink/50 p-3 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="tp-title">
      <div className="m-auto grid w-full max-w-3xl overflow-hidden rounded-3xl bg-cream shadow-2xl sm:grid-cols-2">
        <div className="relative aspect-square bg-sand sm:aspect-auto">
          {p.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imageUrl} alt={p.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full min-h-64 items-center justify-center p-8 text-center font-display text-2xl font-bold text-white" style={{ background: accent }}>
              {p.title}
            </div>
          )}
          <button onClick={() => onClose(false)} className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-ink/60 text-2xl leading-none text-white hover:bg-ink sm:hidden" aria-label="Close">×</button>
        </div>
        <div className="relative flex flex-col p-6">
          <button onClick={() => onClose(false)} className="absolute right-3 top-3 hidden h-10 w-10 items-center justify-center rounded-full text-2xl leading-none text-ink-soft hover:bg-sand sm:flex" aria-label="Close">×</button>
          <div className="flex items-center gap-2.5">
            {store.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={store.logoUrl} alt="" className="h-9 w-9 rounded-lg object-cover ring-1 ring-line" />
            )}
            <div className="min-w-0">
              <p className="truncate text-xs font-bold uppercase tracking-[0.16em]" style={{ color: accent }}>{store.brand}</p>
              {store.tagline && <p className="truncate text-xs text-ink-soft">{store.tagline}</p>}
            </div>
          </div>
          <h2 id="tp-title" className="mt-4 font-display text-3xl font-extrabold leading-tight">{p.title}</h2>
          <p className="mt-2 font-display text-3xl font-extrabold">{fmtPrice(p.price, p.currency)}</p>
          {p.description && <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{p.description}</p>}

          <div className="mt-auto pt-6">
            {p.buyHost ? (
              <>
                <a href={`/leaving/${p.id}`} target="_blank" rel="noopener" className="btn-yellow w-full py-3.5" onClick={() => onClose(false)}>
                  Buy on {p.buyHost}<ArrowUpRight aria-hidden className="ml-1 inline h-4 w-4 align-[-3px]" />
                </a>
                <p className="mt-2 text-center text-xs text-ink-soft">
                  Sold by {store.brand}. You pay {store.brand} directly on their page; they ship and handle your order.
                </p>
              </>
            ) : (
              <p className="rounded-2xl bg-sand px-4 py-3 text-center text-sm text-ink-soft">
                {store.website ? (
                  <>
                    Available from{" "}
                    <a href={store.website} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold underline">
                      {store.brand}
                    </a>
                  </>
                ) : (
                  "Coming soon to buy online."
                )}
              </p>
            )}
            <button onClick={() => onClose(true)} className="mt-2 w-full rounded-full px-5 py-3 text-sm font-semibold ring-1 ring-line hover:bg-sand">Back to the shop</button>
          </div>
        </div>
      </div>
    </div>
  );
}

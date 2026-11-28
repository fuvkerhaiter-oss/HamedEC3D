"use client";

import { useEffect, useMemo } from "react";
import { useCart } from "@/features/cart/cart-store";
import { fmtDay, fmtPrice, shopWhere, type PublicShop } from "@/features/rentals/format";
import { quoteAll } from "@/lib/rentals/pricing";
import { SHOP_ROOM, SHOP_UNITS } from "../env/shops";

/** In-store panel for a rental shop: what it is, the launch prices, and a link to book it. */
export function ShopRentPanel({ shopId, shops, onClose }: { shopId: string; shops?: PublicShop[]; onClose: (resume: boolean) => void }) {
  const market = useCart((s) => s.market);
  const currency = market === "EU" ? "EUR" : "USD";
  const unit = SHOP_UNITS.find((u) => u.id === shopId);
  const info = shops?.find((s) => s.id === shopId);
  const quotes = useMemo(() => quoteAll(currency), [currency]);
  const rented = info?.state === "rented";
  const held = info?.state === "held";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!unit) return null;
  const width = Math.round((unit.roomX1 - unit.roomX0) * 10) / 10;
  const store = rented ? (info?.storefront ?? null) : null;

  if (store) {
    // An open tenant shop: the brand's card instead of the rental pitch.
    return (
      <div className="fixed inset-0 z-30 flex overflow-y-auto overscroll-contain bg-ink/50 p-3 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="shop-title">
        <div className="m-auto w-full max-w-lg overflow-hidden rounded-3xl bg-cream shadow-2xl">
          <div className="relative bg-brand-deep px-6 pb-6 pt-5 text-white">
            <button onClick={() => onClose(false)} className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full text-2xl leading-none text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close">×</button>
            <div className="flex items-center gap-4">
              {store.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={store.logoUrl} alt="" className="h-16 w-16 rounded-2xl bg-white object-cover" />
              )}
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber">{unit.label} · Open</p>
                <h2 id="shop-title" className="truncate font-display text-3xl">{store.brand}</h2>
                {store.tagline && <p className="mt-0.5 text-sm text-white/75">{store.tagline}</p>}
              </div>
            </div>
          </div>
          <div className="px-6 py-6">
            {store.about && <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">{store.about}</p>}
            <p className="mt-4 text-sm">
              <b>{store.products.length}</b> product{store.products.length === 1 ? "" : "s"} on the shelves. Walk in and aim at one to see it.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button onClick={() => onClose(true)} className="btn-yellow flex-1 justify-center py-3.5">Walk in</button>
              {store.website && (
                <a href={store.website} target="_blank" rel="noopener noreferrer nofollow" className="rounded-full px-5 py-3.5 text-center text-sm font-semibold ring-1 ring-line hover:bg-sand">
                  Website ↗
                </a>
              )}
              {store.instagram && (
                <a href={`https://instagram.com/${store.instagram}`} target="_blank" rel="noopener noreferrer nofollow" className="rounded-full px-5 py-3.5 text-center text-sm font-semibold ring-1 ring-line hover:bg-sand">
                  Instagram ↗
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex overflow-y-auto overscroll-contain bg-ink/50 p-3 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="shop-title">
      <div className="m-auto w-full max-w-lg overflow-hidden rounded-3xl bg-cream shadow-2xl">
        <div className="relative bg-brand-deep px-6 pb-6 pt-5 text-white">
          <button onClick={() => onClose(false)} className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full text-2xl leading-none text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close">×</button>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber">{rented ? "Rented" : held ? "Being booked" : "For rent"}</p>
          <h2 id="shop-title" className="mt-1 font-display text-4xl">{rented && info?.brand ? info.brand : unit.label}</h2>
          <p className="mt-1 text-sm text-white/70">
            {unit.label} · {shopWhere(unit)} · {width} m wide × {SHOP_ROOM.depth} m deep
          </p>
        </div>

        <div className="px-6 py-6">
          {rented ? (
            <p className="text-ink-soft">This shop is rented{info?.until ? ` until ${fmtDay(info.until)}` : ""}. Other shops may still be free.</p>
          ) : held ? (
            <p className="text-ink-soft">Someone is booking this shop right now. Check back in about 30 minutes, or pick another shop.</p>
          ) : (
            <>
              <p className="text-ink-soft">Open your brand&apos;s own shop right here, where shoppers walk. Your name on the sign, set up by our team.</p>
              <ul className="mt-5 grid grid-cols-3 gap-2">
                {quotes.map((q) => (
                  <li key={q.plan} className={`relative rounded-2xl p-3 text-center ${q.plan === "yearly" ? "bg-ink text-white" : "bg-white ring-1 ring-line"}`}>
                    <p className={`text-[11px] font-bold uppercase tracking-wider ${q.plan === "yearly" ? "text-amber" : "text-brand"}`}>{q.months === 1 ? "Month" : q.months === 12 ? "Year" : `${q.months} months`}</p>
                    <p className="font-display text-2xl font-extrabold leading-tight">{fmtPrice(q.amount, currency)}</p>
                  </li>
                ))}
              </ul>
              {quotes[0]?.promoEndsAt && <p className="mt-3 text-center text-xs text-ink-soft">Introductory prices for bookings paid by {fmtDay(quotes[0].promoEndsAt)}</p>}
            </>
          )}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
            <a
              href={`/rent-a-shop${rented || held ? "" : `?shop=${unit.id}`}#book`}
              target="_blank"
              rel="noopener"
              className="btn-yellow flex-1 justify-center py-3.5"
              onClick={() => onClose(false)}
            >
              {rented || held ? "See free shops" : `Rent ${unit.label}`}
            </a>
            <button onClick={() => onClose(true)} className="rounded-full px-5 py-3.5 text-sm font-semibold ring-1 ring-line hover:bg-sand">Back to the store</button>
          </div>
        </div>
      </div>
    </div>
  );
}

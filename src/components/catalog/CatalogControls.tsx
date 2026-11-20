"use client";

/** Interactive pieces of the /catalog page. All state is in the URL; filtering happens on the server. */
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useCart } from "@/features/cart/cart-store";
import { catalogHref, SORT_LABELS, SORTS, type CatalogQuery, type SortId } from "@/lib/catalog/query";
import { MARKETS, type MarketId } from "@/lib/markets";

const subscribeHydration = (cb: () => void) => useCart.persist.onFinishHydration(cb);

/** The shopper's market once the persisted cart has loaded (null before, to avoid acting on the default). */
export function useHydratedMarket(): MarketId | null {
  const hydrated = useSyncExternalStore(subscribeHydration, () => useCart.persist.hasHydrated(), () => false);
  const market = useCart((s) => s.market);
  return hydrated ? market : null;
}

/**
 * Price filters/sorts are evaluated server-side in the URL's `market` currency. When the shopper's
 * market differs (switched region, or a shared link), re-run the query in their currency.
 * Typed price bounds are dropped because they were in the other currency.
 */
export function MarketParamSync({ query }: { query: CatalogQuery }) {
  const router = useRouter();
  const market = useHydratedMarket();
  const priceState = !!(query.min || query.max || query.sort.startsWith("price"));
  useEffect(() => {
    if (market && priceState && market !== query.market) {
      router.replace(catalogHref(query, { market, min: null, max: null }), { scroll: false });
    }
  }, [market, priceState, query, router]);
  return null;
}

export function SortSelect({ query }: { query: CatalogQuery }) {
  const router = useRouter();
  const market = useHydratedMarket() ?? query.market;
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="whitespace-nowrap text-sm text-ink-soft">Sort by</label>
      <select
        id={id}
        value={query.sort}
        onChange={(e) => router.push(catalogHref(query, { sort: e.target.value as SortId, market }), { scroll: false })}
        className="rounded-lg border border-line bg-white py-2 pl-3 pr-8 text-sm font-medium text-ink shadow-sm"
      >
        {SORTS.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
      </select>
    </div>
  );
}

const DECIMAL = /^\d{1,9}(\.\d{1,2})?$/;

export function PriceRangeForm({ query }: { query: CatalogQuery }) {
  const router = useRouter();
  const market = useHydratedMarket() ?? query.market;
  const sameMarket = market === query.market;
  const symbol = MARKETS[market].currency === "EUR" ? "€" : "$";
  const [min, setMin] = useState(sameMarket ? query.min ?? "" : "");
  const [max, setMax] = useState(sameMarket ? query.max ?? "" : "");
  const [error, setError] = useState("");
  const id = useId();

  // Keep inputs in step with the URL (chip removal, clear all, market switch).
  const key = `${query.min}|${query.max}|${query.market}|${market}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setMin(sameMarket ? query.min ?? "" : "");
    setMax(sameMarket ? query.max ?? "" : "");
    setError("");
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const lo = min.trim().replace(",", ".");
        const hi = max.trim().replace(",", ".");
        if ((lo && !DECIMAL.test(lo)) || (hi && !DECIMAL.test(hi))) {
          setError("Enter amounts like 5 or 12.50");
          return;
        }
        setError("");
        router.push(catalogHref(query, { min: lo || null, max: hi || null, market }), { scroll: false });
      }}
    >
      <div className="flex items-center gap-2">
        {(["min", "max"] as const).map((which) => (
          <div key={which} className="relative min-w-0 flex-1">
            <label htmlFor={`${id}-${which}`} className="sr-only">{which === "min" ? "Minimum" : "Maximum"} price in {MARKETS[market].currency}</label>
            <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-soft">{symbol}</span>
            <input
              id={`${id}-${which}`}
              inputMode="decimal"
              autoComplete="off"
              placeholder={which === "min" ? "Min" : "Max"}
              value={which === "min" ? min : max}
              onChange={(e) => (which === "min" ? setMin : setMax)(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-err` : undefined}
              className="w-full rounded-lg border border-line bg-white py-2 pl-6 pr-2 text-sm tabular-nums"
            />
          </div>
        ))}
        <button type="submit" className="shrink-0 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-cream transition hover:bg-brand" aria-label="Apply price range">
          Go
        </button>
      </div>
      {error && <p id={`${id}-err`} role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      <p className="mt-2 text-xs text-ink-soft">{MARKETS[market].taxMode === "inclusive" ? "Prices include VAT" : "Prices before sales tax"}</p>
    </form>
  );
}

/** Mobile/tablet: slide-in filter drawer wrapping the server-rendered filter panel. */
export function FilterDrawer({ children, activeCount, resultCount }: { children: ReactNode; activeCount: number; resultCount: number }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab" && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>("a[href],button,input,select,[tabindex]:not([tabindex='-1'])");
        if (f.length === 0) return;
        const firstEl = f[0]!;
        const lastEl = f[f.length - 1]!;
        if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === panel.current)) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const t = trigger.current;
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      t?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold shadow-sm lg:hidden"
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 5h14M6 10h8M8.5 15h3" />
        </svg>
        Filters
        {activeCount > 0 && <span className="rounded-full bg-brand px-1.5 font-mono text-[11px] text-cream">{activeCount}</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/50 backdrop-blur-[2px] motion-safe:animate-[vsw-fade_200ms_ease-out]" onClick={() => setOpen(false)} aria-hidden />
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-[min(22rem,88vw)] flex-col bg-cream shadow-lift outline-none motion-safe:animate-[vsw-slide-in_240ms_cubic-bezier(0.2,0.8,0.2,1)]"
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 id={titleId} className="font-display text-xl">Filters</h2>
              <button type="button" onClick={() => setOpen(false)} className="-mr-2 rounded-full p-2 text-ink-soft hover:bg-sand hover:text-ink" aria-label="Close filters">
                <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            <div className="border-t border-line p-4">
              <button type="button" onClick={() => setOpen(false)} className="w-full rounded-full bg-ink py-3 text-sm font-semibold text-cream transition hover:bg-brand">
                Show {resultCount} result{resultCount === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

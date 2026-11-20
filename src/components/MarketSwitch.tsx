"use client";

import { useCart } from "@/features/cart/cart-store";
import type { MarketId } from "@/lib/markets";

const OPTIONS: { id: MarketId; label: string }[] = [
  { id: "EU", label: "EU €" },
  { id: "US", label: "US $" },
];

export function MarketSwitch({ dark = false }: { dark?: boolean }) {
  const market = useCart((s) => s.market);
  const setMarket = useCart((s) => s.setMarket);
  return (
    <div role="radiogroup" aria-label="Shopping region" className={`flex rounded-full p-1 font-mono text-[11px] ${dark ? "bg-white/10" : "bg-white ring-1 ring-line"}`}>
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={market === o.id}
          onClick={() => setMarket(o.id)}
          className={`whitespace-nowrap rounded-full px-2.5 py-1 font-medium transition sm:px-3 ${
            market === o.id ? (dark ? "bg-cream text-ink" : "bg-ink text-cream") : dark ? "text-cream/80" : "text-ink-soft"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

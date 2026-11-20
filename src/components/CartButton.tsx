"use client";

import { cartCount, useCart } from "@/features/cart/cart-store";

export function CartButton({ dark = false }: { dark?: boolean }) {
  const count = useCart((s) => cartCount(s.lines));
  const setOpen = useCart((s) => s.setOpen);
  return (
    <button
      onClick={() => setOpen(true)}
      className={`relative inline-flex items-center rounded-full py-2 pl-4 pr-2 text-sm font-semibold transition active:scale-95 ${dark ? "bg-cream text-ink hover:bg-white" : "bg-ink text-cream hover:bg-brand"}`}
      aria-label={`Open cart, ${count} item${count === 1 ? "" : "s"}`}
    >
      Cart
      <span className={`ml-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-mono text-xs tabular-nums ${dark ? "bg-ink text-cream" : "bg-amber text-ink"}`}>
        {count}
      </span>
    </button>
  );
}

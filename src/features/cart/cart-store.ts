"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartLineInput } from "@/lib/cart/pricing";
import { MAX_LINE_QUANTITY } from "@/lib/cart/pricing";
import type { MarketId } from "@/lib/markets";

/**
 * Client cart mirror: only variant ids + quantities (never prices).
 * Prices/stock come from /api/cart/price. Server-side persistence for signed-in users: Phase 2.
 */
interface CartState {
  lines: CartLineInput[];
  market: MarketId;
  open: boolean;
  add: (variantId: string, quantity?: number) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  setMarket: (market: MarketId) => void;
  setOpen: (open: boolean) => void;
}

const clampQty = (q: number) => Math.max(1, Math.min(MAX_LINE_QUANTITY, Math.floor(q)));

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      market: "EU",
      open: false,
      add: (variantId, quantity = 1) =>
        set((s) => {
          const existing = s.lines.find((l) => l.variantId === variantId);
          const lines = existing
            ? s.lines.map((l) => (l.variantId === variantId ? { ...l, quantity: clampQty(l.quantity + quantity) } : l))
            : [...s.lines, { variantId, quantity: clampQty(quantity) }];
          return { lines };
        }),
      setQuantity: (variantId, quantity) =>
        set((s) => ({ lines: s.lines.map((l) => (l.variantId === variantId ? { ...l, quantity: clampQty(quantity) } : l)) })),
      remove: (variantId) => set((s) => ({ lines: s.lines.filter((l) => l.variantId !== variantId) })),
      clear: () => set({ lines: [] }),
      setMarket: (market) => set({ market }),
      setOpen: (open) => set({ open }),
    }),
    {
      name: "vsw-cart",
      version: 1,
      skipHydration: true, // rehydrated in <Providers> after mount to avoid hydration mismatch
      partialize: (s) => ({ lines: s.lines, market: s.market }),
    },
  ),
);

export const cartCount = (lines: CartLineInput[]) => lines.reduce((n, l) => n + l.quantity, 0);

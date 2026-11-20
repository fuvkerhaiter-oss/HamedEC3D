"use client";

import { useEffect, useState } from "react";
import type { PricedCart } from "@/lib/cart/pricing";
import { useCart } from "./cart-store";

type Status = "idle" | "loading" | "ready" | "error";
type Result = { key: string; cart: PricedCart | null; error: boolean };

/** Fetches authoritative pricing whenever lines or market change. Keeps the last cart visible while reloading. */
export function usePricedCart(enabled: boolean): { status: Status; cart: PricedCart | null } {
  const lines = useCart((s) => s.lines);
  const market = useCart((s) => s.market);
  const key = JSON.stringify({ market, lines });
  const [res, setRes] = useState<Result | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    fetch("/api/cart/price", { method: "POST", headers: { "Content-Type": "application/json" }, body: key, signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setRes({ key, cart: (await r.json()) as PricedCart, error: false });
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== "AbortError") setRes({ key, cart: null, error: true });
      });
    return () => ctrl.abort();
  }, [enabled, key]);

  const status: Status = !enabled ? "idle" : !res || res.key !== key ? "loading" : res.error ? "error" : "ready";
  return { status, cart: res?.cart ?? null };
}

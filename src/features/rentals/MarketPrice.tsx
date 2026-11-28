"use client";

import { useSyncExternalStore } from "react";
import { useCart } from "@/features/cart/cart-store";
import type { RentalCurrency } from "@/lib/rentals/pricing";
import { fmtPrice } from "./format";

const noopSubscribe = () => () => {};

/** Price in the visitor's selected market currency (EU → EUR, US → USD); server render uses EUR (home market). */
export function MarketPrice({ amounts }: { amounts: Record<RentalCurrency, number> }) {
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const market = useCart((s) => s.market);
  const currency: RentalCurrency = hydrated && market === "US" ? "USD" : "EUR";
  return <>{fmtPrice(amounts[currency], currency)}</>;
}

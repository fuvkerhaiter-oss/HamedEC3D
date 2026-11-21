"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCart } from "@/features/cart/cart-store";

/** While the payment webhook is on its way, re-render the order page every 3 s (up to 2 min). Empties the cart once bought. */
export function OrderAutoRefresh({ active, clearCart }: { active: boolean; clearCart: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (clearCart) {
      useCart.getState().clear();
      try { sessionStorage.removeItem("mm.checkoutKey"); } catch { /* private mode */ }
    }
  }, [clearCart]);
  useEffect(() => {
    if (!active) return;
    let n = 0;
    const id = setInterval(() => (++n > 40 ? clearInterval(id) : router.refresh()), 3000);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}

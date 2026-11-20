"use client";

import { useEffect, type ReactNode } from "react";
import { useCart } from "@/features/cart/cart-store";
import { CartDrawer } from "@/features/cart/CartDrawer";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    void useCart.persist.rehydrate();
  }, []);
  return (
    <>
      {children}
      <CartDrawer />
    </>
  );
}

"use client";

import { useCart } from "@/features/cart/cart-store";
import { useStoreUi } from "./ui-store";
import { requestSpin } from "./wing/lucky-wheel";

/**
 * Gameplay actions shared by every input layer (keyboard E/C, touch buttons), so desktop and mobile
 * drive exactly the same product panel / cart flow.
 */

/** Interact with what the crosshair is on. Returns false when nothing is targeted. */
export function interactWithTarget(): boolean {
  const ui = useStoreUi.getState();
  if (!ui.locked || !ui.target) return false;
  if (ui.target.kind === "wheel") {
    requestSpin(); // stays in play: the shopper watches the wheel
    return true;
  }
  if (ui.target.kind === "product") ui.openProduct(ui.target.productId);
  else useCart.getState().setOpen(true);
  ui.releaseLock();
  return true;
}

export function openCartFromStore() {
  useCart.getState().setOpen(true);
  useStoreUi.getState().releaseLock();
}

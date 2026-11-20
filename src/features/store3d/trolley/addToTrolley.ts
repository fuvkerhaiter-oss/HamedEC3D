"use client";

import { useCart } from "@/features/cart/cart-store";
import type { Vec3 } from "../layout";
import { FLIGHT, unitKey } from "./geometry";
import { lastHit, useTrolley, type Flight } from "./trolley-store";

const MAX_ANIMATED = 8; // more units than this appear instantly

/** Adds to the cart (ids + quantity only) and launches the shelf → trolley animation. Returns units added. */
export function addToTrolley(variantId: string, productId: string, quantity: number): number {
  const before = useCart.getState().lines.find((l) => l.variantId === variantId)?.quantity ?? 0;
  useCart.getState().add(variantId, quantity);
  const after = useCart.getState().lines.find((l) => l.variantId === variantId)?.quantity ?? before;

  const from: Vec3 | null = lastHit.productId === productId ? [lastHit.point.x, lastHit.point.y, lastHit.point.z] : null;
  const flights: Flight[] = [];
  for (let n = before; n < after && flights.length < MAX_ANIMATED; n++) {
    flights.push({ key: unitKey(variantId, n), productId, from, delay: (n - before) * FLIGHT.stagger });
  }
  if (flights.length) useTrolley.getState().launch(flights);
  return after - before;
}

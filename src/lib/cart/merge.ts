import type { CartLineInput } from "./pricing";
import { MAX_LINE_QUANTITY, MAX_CART_LINES } from "./pricing";

export interface MergeConflict {
  variantId: string;
  guestQuantity: number;
  accountQuantity: number;
  finalQuantity: number;
  clamped: boolean;
}

export interface MergeResult {
  lines: CartLineInput[];
  conflicts: MergeConflict[];
  mergedCount: number;
}

/**
 * Pure function to merge a guest cart with an existing authenticated account cart.
 * - Handles duplicate variants by combining quantities, clamped to MAX_LINE_QUANTITY (99).
 * - Caps total unique items at MAX_CART_LINES (50).
 * - Detects conflicts and records any clamping.
 * - Leaves pricing entirely to the server pricing engine.
 */
export function mergeCartLines(
  guestLines: CartLineInput[] = [],
  accountLines: CartLineInput[] = [],
): MergeResult {
  const map = new Map<string, number>();
  const conflicts: MergeConflict[] = [];

  // Seed with account cart lines first
  for (const line of accountLines) {
    if (!line?.variantId || typeof line.quantity !== "number" || line.quantity <= 0) continue;
    map.set(line.variantId, Math.min(MAX_LINE_QUANTITY, Math.floor(line.quantity)));
  }

  let mergedCount = 0;
  // Merge in guest cart lines
  for (const guest of guestLines) {
    if (!guest?.variantId || typeof guest.quantity !== "number" || guest.quantity <= 0) continue;
    const existing = map.get(guest.variantId);
    if (existing !== undefined) {
      const combined = existing + Math.floor(guest.quantity);
      const finalQuantity = Math.min(MAX_LINE_QUANTITY, combined);
      map.set(guest.variantId, finalQuantity);
      conflicts.push({
        variantId: guest.variantId,
        guestQuantity: Math.floor(guest.quantity),
        accountQuantity: existing,
        finalQuantity,
        clamped: combined > MAX_LINE_QUANTITY,
      });
      mergedCount++;
    } else {
      map.set(guest.variantId, Math.min(MAX_LINE_QUANTITY, Math.floor(guest.quantity)));
      mergedCount++;
    }
  }

  const lines: CartLineInput[] = Array.from(map.entries())
    .slice(0, MAX_CART_LINES)
    .map(([variantId, quantity]) => ({ variantId, quantity }));

  return { lines, conflicts, mergedCount };
}

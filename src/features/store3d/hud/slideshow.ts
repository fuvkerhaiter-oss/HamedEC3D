/** Pure index helpers for the product photo slideshow (unit tested). */

/** Index `step` photos away from `i`, wrapping around a gallery of `n`. */
export function stepIndex(i: number, n: number, step: number): number {
  if (n <= 0) return 0;
  return (((i + step) % n) + n) % n;
}

/**
 * Photos kept mounted: the one fading out (`from`), the visible one and the NEXT one (preloaded as the same
 * resized copy). Nothing else is downloaded until it is about to be shown.
 */
export function slideLayers(from: number, current: number, n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  return [...new Set([from, current, stepIndex(current, n, 1)])].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
}

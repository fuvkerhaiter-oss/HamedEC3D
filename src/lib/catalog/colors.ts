/** Category accent colors used for placeholders and UI. */
const CATEGORY_COLORS: Record<string, string> = { pantry: "#c9773b", drinks: "#3a7ca5", snacks: "#c4493a", household: "#5b8c5a" };
const FALLBACK = ["#8a6fb0", "#b0896f", "#6f9bb0", "#a3b06f"];

export function categoryColor(slug: string | undefined, index = 0): string {
  return (slug && CATEGORY_COLORS[slug]) || FALLBACK[index % FALLBACK.length]!;
}

/**
 * Distinct box colours for 3D shelf placeholders: picked so neighbours read as different products
 * (spread hue, alternating lightness). Order matters: greedy colouring tries them in this order.
 */
export const PRODUCT_PALETTE = [
  "#c9773b", "#3a7ca5", "#c4493a", "#5b8c5a", "#8a6fb0", "#d4a72c",
  "#2f9e9a", "#b0537e", "#6d7f2f", "#4f63b8", "#a35a2a", "#7aa6c9",
] as const;

/** Colour for palette slot `i`; past the palette, golden-angle hues keep every slot distinct. */
export function paletteColor(i: number): string {
  if (i < PRODUCT_PALETTE.length) return PRODUCT_PALETTE[i]!;
  const hue = ((i - PRODUCT_PALETTE.length) * 137.508 + 17) % 360;
  const light = i % 2 ? 42 : 52;
  return hslToHex(hue, 55, light);
}

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Pure, deterministic per-product colours: greedy graph colouring over shelf neighbours, so two different
 * products that sit next to each other never share a colour. Each product starts from a slot derived from its
 * id (variety even without neighbours) and takes the first slot no already-coloured neighbour uses.
 */
export function assignProductColors(order: readonly string[], neighbours: ReadonlyMap<string, ReadonlySet<string>>): Record<string, string> {
  const slot = new Map<string, number>();
  for (const id of order) {
    if (slot.has(id)) continue;
    const used = new Set<number>();
    for (const n of neighbours.get(id) ?? []) if (n !== id && slot.has(n)) used.add(slot.get(n)!);
    const start = hash(id) % PRODUCT_PALETTE.length;
    let s = -1;
    for (let k = 0; k < PRODUCT_PALETTE.length; k++) if (!used.has((start + k) % PRODUCT_PALETTE.length)) { s = (start + k) % PRODUCT_PALETTE.length; break; }
    if (s < 0) for (s = PRODUCT_PALETTE.length; used.has(s); s++);
    slot.set(id, s);
  }
  return Object.fromEntries([...slot].map(([id, s]) => [id, paletteColor(s)]));
}

/** Category accent colors used for placeholders and UI. */
const CATEGORY_COLORS: Record<string, string> = { pantry: "#c9773b", drinks: "#3a7ca5", snacks: "#c4493a", household: "#5b8c5a" };
const FALLBACK = ["#8a6fb0", "#b0896f", "#6f9bb0", "#a3b06f"];

export function categoryColor(slug: string | undefined, index = 0): string {
  return (slug && CATEGORY_COLORS[slug]) || FALLBACK[index % FALLBACK.length]!;
}

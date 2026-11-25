/** Per-viewer admin preferences kept in localStorage. Pure, so a bad value can never crash the shell. */

/** Page guides the viewer has hidden. Always an array of hrefs, even if storage holds an old/corrupt value. */
export function parseHiddenGuides(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

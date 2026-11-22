/** next/image optimization only for hosts configured in next.config (Supabase Storage); everything else is served as-is. */
export function canOptimize(url: string): boolean {
  return /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\/(products|product-images)\//.test(url); // = next.config remotePatterns
}

/** Widths the Next image optimizer accepts (must stay in next.config `images.imageSizes`/`deviceSizes`). */
export const OPTIMIZER_WIDTHS = [256, 640] as const;

/**
 * URL of a resized WebP copy for non-<Image> consumers (3D shelf textures): served from the image optimizer's
 * cache, so the full-size original is fetched from Supabase once per width instead of on every store visit.
 * Hosts we can't optimize are returned unchanged.
 */
export function resizedImageUrl(url: string, width: (typeof OPTIMIZER_WIDTHS)[number]): string {
  return canOptimize(url) ? `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=75` : url;
}

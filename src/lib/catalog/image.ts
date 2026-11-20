/** next/image optimization only for hosts configured in next.config (Supabase Storage); everything else is served as-is. */
export function canOptimize(url: string): boolean {
  return /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\//.test(url);
}

/** Shown while the catalog query runs (search, filters, slow database). */
export default function CatalogLoading() {
  return (
    <div className="pb-20" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading products…</p>
      <div className="border-b border-line bg-sand/50">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8">
          <div className="h-3 w-32 animate-pulse rounded bg-line" />
          <div className="mt-5 h-12 animate-pulse rounded-full bg-white/70" />
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-5">
        <div className="h-8 w-48 animate-pulse rounded bg-line" />
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="overflow-hidden rounded-2xl bg-white/70">
              <div className="aspect-square animate-pulse bg-sand" />
              <div className="space-y-2 p-4">
                <div className="h-4 w-3/4 animate-pulse rounded bg-line" />
                <div className="h-4 w-1/3 animate-pulse rounded bg-line" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

"use client";

/** An admin page failed to load (most often the database answered too slowly). Details stay in the server log. */
export default function AdminPageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
      <p className="text-lg font-semibold">This page didn&apos;t load</p>
      <p className="mt-1 text-sm">
        The database may be slow or unreachable for a moment. Nothing was changed. Please try again; if it keeps happening, the server log has the details.
      </p>
      <button type="button" onClick={reset} className="btn-primary mt-4">Try again</button>
    </div>
  );
}

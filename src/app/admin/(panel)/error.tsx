"use client";

/** An admin page failed to load. The digest matches the server-log line; details are never shown to the viewer. */
export default function AdminPageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
      <p className="text-lg font-semibold">This page didn&apos;t load</p>
      <p className="mt-1 text-sm">
        Something went wrong while loading this page. Nothing was changed. Please try again.
      </p>
      {error.digest && <p className="mt-3 text-xs opacity-70">Reference: <span className="font-mono">{error.digest}</span></p>}
      <button type="button" onClick={reset} className="btn-primary mt-4">Try again</button>
    </div>
  );
}

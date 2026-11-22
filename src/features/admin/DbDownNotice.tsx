import { Notice } from "./ui";

/** Full-page admin notice when the database can't be reached or doesn't answer in time (details in the server log). */
export function DbDownNotice() {
  return (
    <div className="grid min-h-dvh place-items-center bg-cream px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <Notice tone="warn" title="Can’t reach the database right now">
          The admin couldn&apos;t load because the database didn&apos;t answer within a few seconds. Your shop data is safe.
          This is usually temporary: wait a moment and try again. If it keeps happening, check the database (Supabase) status and the
          Vercel logs — the server log has the details.
        </Notice>
        <a href="/admin" className="btn-primary inline-block">Try again</a>
      </div>
    </div>
  );
}

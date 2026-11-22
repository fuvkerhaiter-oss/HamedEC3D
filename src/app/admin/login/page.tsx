import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm } from "@/features/admin/ActionForm";
import { Notice } from "@/features/admin/ui";
import { getAdminSession } from "@/lib/admin/guard";
import { isDbConfigured } from "@/lib/db/client";
import { isDbUnreachable, logError } from "@/lib/log";
import { loginAction } from "../auth-actions";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const configured = isDbConfigured();
  // Database down/unreachable: explain it here instead of a blank 500 (details only in the server log).
  const session = configured ? await getAdminSession().catch((err: unknown) => {
    if (!isDbUnreachable(err)) throw err;
    logError("admin login: database unreachable", err);
    return "unreachable" as const;
  }) : null;
  const unreachable = session === "unreachable";
  if (session && !unreachable) redirect("/admin");
  const { next } = await searchParams;
  return (
    <div className="vsw-grid-bg grid min-h-dvh place-items-center bg-ink px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3 text-cream">
          <span aria-hidden className="grid h-10 w-10 place-items-center rounded-xl bg-amber font-display text-lg text-ink">W</span>
          <div>
            <p className="font-display text-xl leading-none">WEGO SHIIIP.</p>
            <p className="eyebrow mt-1 !text-[10px] text-cream/50">Admin console</p>
          </div>
        </div>
        <div className="rounded-2xl bg-cream p-6 shadow-2xl">
          <h1 className="font-display text-2xl">Sign in</h1>
          <p className="mt-1 text-sm text-ink-soft">Staff accounts only. Customer accounts can&apos;t sign in here.</p>
          {unreachable ? (
            <div className="mt-5">
              <Notice tone="warn" title="Can’t reach the database">
                Sign-in is unavailable because the server can&apos;t connect to the database. If this is a Vercel deployment, set <code>DATABASE_URL</code> to the Supabase <strong>Transaction pooler</strong> connection string (…pooler.supabase.com:6543), not the direct db.…supabase.co host, then redeploy. The server log has the details.
              </Notice>
            </div>
          ) : !configured ? (
            <div className="mt-5">
              <Notice tone="warn" title="Database not configured">
                Set <code>DATABASE_URL</code> (Supabase Postgres connection string, or <code>npm run db:local</code> for development), then create the first admin with <code>npm run admin:create</code>. See INTEGRATION_GUIDE.md.
              </Notice>
            </div>
          ) : (
            <ActionForm action={loginAction} submitLabel="Sign in" className="mt-5">
              <input type="hidden" name="next" value={next ?? ""} />
              <label className="block text-sm">
                <span className="font-medium">Email</span>
                <input name="email" type="email" autoComplete="username" required className="admin-input mt-1" />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Password</span>
                <input name="password" type="password" autoComplete="current-password" required className="admin-input mt-1" />
              </label>
            </ActionForm>
          )}
        </div>
      </div>
    </div>
  );
}

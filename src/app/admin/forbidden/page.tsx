import Link from "next/link";
import { requirePage } from "@/lib/admin/guard";
import { PERMISSIONS, isPermission } from "@/lib/admin/permissions";

export const dynamic = "force-dynamic";

export default async function ForbiddenPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await requirePage();
  const { p } = await searchParams;
  return (
    <div className="grid min-h-dvh place-items-center bg-cream px-4">
      <div className="max-w-md text-center">
        <p className="eyebrow text-brand">403</p>
        <h1 className="mt-2 font-display text-3xl">You don&apos;t have access to this page</h1>
        {p && isPermission(p) && <p className="mt-3 text-sm text-ink-soft">Required permission: <code>{p}</code> — {PERMISSIONS[p]}. Ask a super admin to grant it.</p>}
        <Link href="/admin" className="btn-primary mt-6">Back to the dashboard</Link>
      </div>
    </div>
  );
}

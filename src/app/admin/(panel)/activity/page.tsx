import Link from "next/link";
import { ActivityTabs } from "@/features/admin/ActivityTabs";
import { Card, EmptyState, fmtDate, PageHeader, Table } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { listActivity } from "@/lib/admin/services/people";
import { getSql } from "@/lib/db/client";

export const metadata = { title: "Activity Log" };

const ENTITY_LINK: Record<string, string> = { product: "/admin/products/", order: "/admin/orders/", supplier: "/admin/suppliers/", page: "/admin/content/" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePage("activity.view");
  const sp = await searchParams;
  const page = Number(sp.page) || 1;
  const rows = await listActivity(getSql(), { q: sp.q, entity: sp.entity || undefined, page });
  return (
    <>
      <PageHeader title="Change history" description="Every change made in the admin: who did it, when, and what it was before and after. It can't be edited or deleted." />
      <ActivityTabs active="changes" showVisitors={session.permissions.has("admins.manage")} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search summary, action or id" className="admin-input !w-64 !py-1.5" aria-label="Search activity" />
        <select name="entity" defaultValue={sp.entity ?? ""} className="admin-input !w-auto !py-1.5" aria-label="Entity">
          <option value="">All entities</option>
          {["product", "variant", "category", "order", "supplier", "discount", "setting", "admin_user", "shipping_zone", "shipping_method", "page", "review", "expense", "exchange_rate", "tax_rate"].map((e) => <option key={e} value={e}>{e.replace("_", " ")}</option>)}
        </select>
        <button className="btn-ghost !py-1.5">Filter</button>
      </form>
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-5"><EmptyState title="No activity found" /></div> : (
          <Table head={["When", "Admin", "Action", "Summary", "Changes"]}>
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="whitespace-nowrap text-xs text-ink-soft">{fmtDate(r.created_at)}<span className="block font-mono text-[10px]">{r.ip ?? ""}</span></td>
                <td className="text-xs">{r.admin_email ?? "system"}</td>
                <td className="font-mono text-[11px]">{r.action}</td>
                <td className="text-sm">{r.summary}{r.entity_id && ENTITY_LINK[r.entity] && <Link className="ml-1 text-xs text-brand underline" href={ENTITY_LINK[r.entity] + r.entity_id}>open</Link>}</td>
                <td className="max-w-md">
                  {(r.before != null || r.after != null) && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-ink-soft">diff</summary>
                      <div className="mt-1 grid gap-2 sm:grid-cols-2">
                        <pre className="max-h-48 overflow-auto rounded bg-red-50 p-2 text-[10px]">{r.before == null ? "—" : JSON.stringify(r.before, null, 1)}</pre>
                        <pre className="max-h-48 overflow-auto rounded bg-emerald-50 p-2 text-[10px]">{r.after == null ? "—" : JSON.stringify(r.after, null, 1)}</pre>
                      </div>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="flex justify-between px-4 py-3 text-sm">
          {page > 1 ? <Link className="btn-ghost" href={`?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.entity ? { entity: sp.entity } : {}), page: String(page - 1) })}`}>← Newer</Link> : <span />}
          {rows.length === 50 && <Link className="btn-ghost" href={`?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.entity ? { entity: sp.entity } : {}), page: String(page + 1) })}`}>Older →</Link>}
        </div>
      </Card>
    </>
  );
}

import Link from "next/link";
import { DateRangeForm } from "@/features/admin/DateRangeForm";
import { Card, EmptyState, fmtDate, fmtMoney, PageHeader, Pagination, StatusBadge, Table, TestBadge } from "@/features/admin/ui";
import { resolveRange } from "@/lib/admin/date-range";
import { requirePage } from "@/lib/admin/guard";
import { listOrders } from "@/lib/admin/services/orders";
import { maskEmail } from "@/lib/admin/services/people";
import { getSql } from "@/lib/db/client";
import { ORDER_STATUSES } from "@/lib/orders/state-machine";

export const metadata = { title: "Orders" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePage("orders.view");
  const sp = await searchParams;
  const page = Number(sp.page) || 1;
  const range = sp.range ? resolveRange(sp) : null;
  const status = sp.status && (ORDER_STATUSES as readonly string[]).includes(sp.status) ? sp.status : undefined;
  const { rows, total } = await listOrders(getSql(), { q: sp.q, status, from: range?.from, to: range?.to, page });
  const pii = session.permissions.has("customers.pii");
  const exportQs = new URLSearchParams(Object.entries({ range: sp.range ?? "90d", from: sp.from, to: sp.to }).filter((e): e is [string, string] => !!e[1]));

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Orders"
        description="Status changes go through the order state machine only — every change is validated and recorded on the order timeline."
        actions={session.permissions.has("orders.export") && <a className="btn-ghost" href={`/api/admin/export/orders?${exportQs}`}>Export CSV</a>}
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <form className="flex flex-wrap gap-2">
          <input name="q" defaultValue={sp.q} placeholder="#order, email or name" className="admin-input !w-56 !py-1.5" aria-label="Search orders" />
          <select name="status" defaultValue={status ?? ""} className="admin-input !w-auto !py-1.5" aria-label="Status">
            <option value="">Any status</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          {sp.range && <input type="hidden" name="range" value={sp.range} />}
          <button className="btn-ghost !py-1.5">Filter</button>
        </form>
        <div className="ml-auto"><DateRangeForm range={sp.range ?? "90d"} from={sp.from} to={sp.to} /></div>
      </div>
      <Card pad={false}>
        {rows.length === 0 ? (
          <div className="p-5"><EmptyState title={total === 0 && !sp.q && !status ? "No orders yet" : "No orders match"}>Orders are created by checkout. Test orders created by development tools are labelled TEST.</EmptyState></div>
        ) : (
          <Table head={["Order", "Placed", "Customer", "Items", "Ship to", "Status", "Total"]}>
            {rows.map((o) => (
              <tr key={o.id} className="hover:bg-cream/60">
                <td><Link href={`/admin/orders/${o.id}`} className="font-medium hover:underline">#{o.order_number}</Link> {o.is_test && <TestBadge />}</td>
                <td className="whitespace-nowrap text-xs text-ink-soft">{fmtDate(o.created_at)}</td>
                <td className="text-ink-soft">{pii ? o.email : maskEmail(o.email)}</td>
                <td className="font-mono">{o.item_count}</td>
                <td className="font-mono text-xs">{o.ship_country}</td>
                <td><StatusBadge status={o.status} /></td>
                <td className="font-mono">{fmtMoney(o.total, o.currency)}</td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination page={page} total={total} pageSize={25} params={sp} />
      </Card>
    </>
  );
}

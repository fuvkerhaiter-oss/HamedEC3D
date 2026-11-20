import Link from "next/link";
import { Badge, Card, EmptyState, fmtDate, fmtMoney, Notice, PageHeader, Pagination, StatusBadge, Table, CsvLink } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { getCustomer, listCustomers, maskEmail, maskName } from "@/lib/admin/services/people";
import { getSql } from "@/lib/db/client";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePage("customers.view");
  const sp = await searchParams;
  const pii = session.permissions.has("customers.pii");
  const sql = getSql();
  const page = Number(sp.page) || 1;
  const [{ rows, total, registered }, detail] = await Promise.all([
    listCustomers(sql, { q: sp.q, page }),
    sp.email ? getCustomer(sql, sp.email) : Promise.resolve(null),
  ]);
  const show = (e: string) => (pii ? e : maskEmail(e));

  return (
    <>
      <PageHeader
        eyebrow="People"
        title="Customers"
        description={<>Built from orders (guests and accounts) · {registered} registered storefront account(s). {pii ? "You can see full contact details." : "Contact details are masked — the customers.pii permission reveals them."}</>}
        actions={<CsvLink className="btn-ghost" href="/api/admin/export/customers">Export CSV</CsvLink>}
      />
      {!pii && <div className="mb-4"><Notice>Privacy mode: emails and names are partially hidden. Every view of full details is limited to admins with explicit permission.</Notice></div>}
      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={sp.q} placeholder={pii ? "Email or name" : "Search (exact email works best)"} className="admin-input !w-72 !py-1.5" aria-label="Search customers" />
        <button className="btn-ghost !py-1.5">Search</button>
      </form>
      {detail && (
        <Card title={`Order history · ${show(detail.email)}`} className="mb-4" pad={false} actions={<Link href="?" className="text-sm text-brand">Close</Link>}>
          <Table head={["Order", "Placed", "Status", "Total"]}>
            {detail.orders.map((o) => (
              <tr key={o.id}><td><Link className="font-medium hover:underline" href={`/admin/orders/${o.id}`}>#{o.order_number}</Link></td><td className="text-xs text-ink-soft">{fmtDate(o.created_at)}</td><td><StatusBadge status={o.status} /></td><td className="font-mono">{fmtMoney(o.total, o.currency)}</td></tr>
            ))}
          </Table>
        </Card>
      )}
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-5"><EmptyState title="No customers yet">Customers appear after their first order.</EmptyState></div> : (
          <Table head={["Customer", "Orders", "Paid", "Spent", "Countries", "First order", "Last order"]}>
            {rows.map((c) => (
              <tr key={c.email} className="hover:bg-cream/60">
                <td>
                  <Link href={`?email=${encodeURIComponent(c.email)}`} className="font-medium hover:underline">{pii ? c.name ?? c.email : maskName(c.name ?? "") || maskEmail(c.email)}</Link>
                  <span className="block text-xs text-ink-soft">{show(c.email)} {c.user_id && <Badge tone="blue">account</Badge>}</span>
                </td>
                <td className="font-mono">{c.orders}</td>
                <td className="font-mono">{c.paid_orders}</td>
                <td className="font-mono text-xs">{[c.spent_eur ? fmtMoney(c.spent_eur, "EUR") : null, c.spent_usd ? fmtMoney(c.spent_usd, "USD") : null].filter(Boolean).join(" · ") || "—"}</td>
                <td className="font-mono text-xs">{c.countries.join(", ")}</td>
                <td className="text-xs text-ink-soft">{fmtDate(c.first_order, false)}</td>
                <td className="text-xs text-ink-soft">{fmtDate(c.last_order, false)}</td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination page={page} total={total} pageSize={25} params={sp} />
      </Card>
    </>
  );
}

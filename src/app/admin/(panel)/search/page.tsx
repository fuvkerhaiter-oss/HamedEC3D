import Link from "next/link";
import { Card, EmptyState, fmtMoney, PageHeader, StatusBadge } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { listOrders } from "@/lib/admin/services/orders";
import { maskEmail } from "@/lib/admin/services/people";
import { listProducts } from "@/lib/admin/services/products";
import { getSql } from "@/lib/db/client";

export const metadata = { title: "Search" };

/** Global admin search across orders, products and customers — limited to what the admin may see. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requirePage();
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const sql = getSql();
  const can = (p: Parameters<typeof session.permissions.has>[0]) => session.permissions.has(p);
  const [orders, products, suppliers] = q
    ? await Promise.all([
        can("orders.view") ? listOrders(sql, { q, pageSize: 10 }).then((r) => r.rows) : Promise.resolve([]),
        can("products.view") ? listProducts(sql, { q, pageSize: 10 }).then((r) => r.rows) : Promise.resolve([]),
        can("suppliers.view") ? sql<{ id: string; name: string }[]>`select id, name from public.suppliers where name ilike ${"%" + q + "%"} limit 10` : Promise.resolve([]),
      ])
    : [[], [], []];
  const pii = can("customers.pii");
  const none = !orders.length && !products.length && !suppliers.length;
  return (
    <>
      <PageHeader eyebrow="Search" title={q ? `Results for “${q}”` : "Search"} />
      <form className="mb-6 flex gap-2"><input name="q" defaultValue={q} autoFocus placeholder="Order #, email, product, SKU, supplier" className="admin-input !w-80" aria-label="Search" /><button className="btn-primary">Search</button></form>
      {q && none && <EmptyState title="Nothing found" />}
      <div className="grid gap-4 lg:grid-cols-2">
        {orders.length > 0 && (
          <Card title="Orders">
            <ul className="divide-y divide-line text-sm">{orders.map((o) => <li key={o.id} className="flex flex-wrap items-center gap-2 py-2"><Link className="font-medium hover:underline" href={`/admin/orders/${o.id}`}>#{o.order_number}</Link><span className="text-ink-soft">{pii ? o.email : maskEmail(o.email)}</span><StatusBadge status={o.status} /><span className="ml-auto font-mono">{fmtMoney(o.total, o.currency)}</span></li>)}</ul>
            {can("customers.view") && <Link className="mt-2 inline-block text-sm text-brand underline" href={`/admin/customers?q=${encodeURIComponent(q)}`}>Search customers →</Link>}
          </Card>
        )}
        {products.length > 0 && (
          <Card title="Products">
            <ul className="divide-y divide-line text-sm">{products.map((p) => <li key={p.id} className="flex items-center gap-2 py-2"><Link className="font-medium hover:underline" href={`/admin/products/${p.id}`}>{p.name}</Link><StatusBadge status={p.deleted_at ? "deleted" : p.status} /><span className="ml-auto font-mono text-xs">{p.available} avail.</span></li>)}</ul>
          </Card>
        )}
        {suppliers.length > 0 && (
          <Card title="Suppliers"><ul className="text-sm">{suppliers.map((s) => <li key={s.id} className="py-1"><Link className="hover:underline" href={`/admin/suppliers/${s.id}`}>{s.name}</Link></li>)}</ul></Card>
        )}
      </div>
    </>
  );
}

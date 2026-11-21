import Link from "next/link";
import { Badge, Card, EmptyState, fmtDate, fmtMoney, Notice, PageHeader, StatusBadge, Table } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { listSupplierOrders, listSuppliers } from "@/lib/admin/services/suppliers";
import { getSql } from "@/lib/db/client";
import { SupplierForm } from "@/features/admin/SupplierForm";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await requirePage("suppliers.view");
  const sp = await searchParams;
  const sql = getSql();
  const [suppliers, orders] = await Promise.all([listSuppliers(sql), listSupplierOrders(sql, { status: sp.status })]);
  const canManage = session.permissions.has("suppliers.manage");
  return (
    <>
      <PageHeader title="Suppliers" description="Companies that send your products to customers. When an order is paid, each supplier gets only their items. Place the order with them, then type their order number on the order page." />
      <div className="mb-4"><Notice tone="warn" title="No live supplier integrations yet">Only manual fulfillment is real. API mode needs an adapter written against the supplier&apos;s documented API plus credentials (stored in Supabase Vault, never here). The mock adapter exists for development tests only.</Notice></div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={`Suppliers (${suppliers.length})`} pad={false} className="xl:col-span-2">
          {suppliers.length === 0 ? <div className="p-5"><EmptyState title="No suppliers yet" /></div> : (
            <Table head={["Supplier", "Mode", "Mapped SKUs", "Open orders", "Credentials", ""]}>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td><Link className="font-medium hover:underline" href={`/admin/suppliers/${s.id}`}>{s.name}</Link> {s.is_mock && <Badge tone="ink">mock</Badge>} {!s.is_active && <Badge>inactive</Badge>}<span className="block text-xs text-ink-soft">{s.contact_email ?? ""}</span></td>
                  <td><Badge tone={s.fulfillment_mode === "api" ? "blue" : "gray"}>{s.fulfillment_mode}</Badge> <span className="font-mono text-[11px] text-ink-soft">{s.adapter_key}</span></td>
                  <td className="font-mono">{s.mapped_variants}</td>
                  <td className={`font-mono ${s.open_orders ? "text-amber-700" : ""}`}>{s.open_orders}</td>
                  <td className="text-xs">{s.has_credentials ? "stored in Vault" : "none"}</td>
                  <td><Link className="text-sm text-brand" href={`/admin/suppliers/${s.id}`}>Manage →</Link></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {canManage && <Card title="Add supplier"><SupplierForm /></Card>}
      </div>
      <Card title="Supplier orders" className="mt-6" pad={false} actions={
        <nav className="flex gap-1 text-xs">{["", "manual_required", "failed", "submitting", "submitted"].map((s) => <Link key={s} href={s ? `?status=${s}` : "?"} className={`rounded-full px-2.5 py-1 ${(sp.status ?? "") === s ? "bg-ink text-cream" : "text-ink-soft hover:bg-sand/60"}`}>{s ? s.replace("_", " ") : "all"}</Link>)}</nav>
      }>
        {orders.length === 0 ? <p className="p-5 text-sm text-ink-soft">No supplier orders.</p> : (
          <Table head={["Order", "Supplier", "Status", "Ref", "Items", "Cost", "Created", "Note"]}>
            {orders.map((o) => (
              <tr key={o.id}>
                <td><Link className="font-medium hover:underline" href={`/admin/orders/${o.order_id}`}>#{o.order_number}</Link></td>
                <td>{o.supplier_name}</td>
                <td><StatusBadge status={o.status} /></td>
                <td className="font-mono text-xs">{o.supplier_order_ref ?? "—"}</td>
                <td className="font-mono">{o.item_count}</td>
                <td className="font-mono text-xs">{o.cost_total !== null ? fmtMoney(o.cost_total, o.cost_currency) : "—"}</td>
                <td className="text-xs text-ink-soft">{fmtDate(o.created_at)}</td>
                <td className="max-w-64 text-xs text-amber-800">{o.last_error ?? ""}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

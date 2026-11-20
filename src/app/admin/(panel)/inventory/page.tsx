import Link from "next/link";
import { ActionForm } from "@/features/admin/ActionForm";
import { Card, EmptyState, fmtDate, PageHeader, Pagination, Table, CsvLink } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { listInventory, listMovements } from "@/lib/admin/services/catalog-admin";
import { getSql } from "@/lib/db/client";
import { adjustStockAction, incomingAction } from "../catalog-actions";

export const metadata = { title: "Inventory" };

const FILTERS = [["", "All"], ["low", "Low stock"], ["out", "Out of stock"], ["reserved", "Reserved by orders"]] as const;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePage("inventory.view");
  const sp = await searchParams;
  const sql = getSql();
  const page = Number(sp.page) || 1;
  const filter = sp.filter === "low" || sp.filter === "out" || sp.filter === "reserved" ? sp.filter : undefined;
  const [{ rows, total }, moves] = await Promise.all([listInventory(sql, { q: sp.q, filter, page }), listMovements(sql, { pageSize: 25 })]);
  const canAdjust = session.permissions.has("inventory.adjust");

  return (
    <>
      <PageHeader
        eyebrow="Stock"
        title="Inventory"
        description="Available = on hand − reserved. Orders reserve stock atomically at checkout (no overselling); a failed or cancelled payment releases it, shipping commits it. Every change is logged."
        actions={<CsvLink href="/api/admin/export/inventory" className="btn-ghost">Export CSV</CsvLink>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={`?${new URLSearchParams(k ? { filter: k } : {})}`} className={`rounded-full px-3 py-1.5 text-sm ${(sp.filter ?? "") === k ? "bg-ink text-cream" : "text-ink-soft hover:bg-sand/60"}`}>{label}</Link>
        ))}
        <form className="ml-auto flex gap-2">
          {filter && <input type="hidden" name="filter" value={filter} />}
          <input name="q" defaultValue={sp.q} placeholder="Product or SKU" className="admin-input !w-56 !py-1.5" aria-label="Search inventory" />
          <button className="btn-ghost !py-1.5">Search</button>
        </form>
      </div>
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-5"><EmptyState title="Nothing here">No variants match this filter.</EmptyState></div> : (
          <Table head={["Product / SKU", "On hand", "Reserved", "Available", "Incoming", "Supplier reports", canAdjust ? "Adjust" : ""]}>
            {rows.map((r) => (
              <tr key={r.variant_id} className={r.available <= 0 ? "bg-red-50/50" : r.available <= r.threshold ? "bg-amber-50/50" : ""}>
                <td className="min-w-52">
                  <Link href={`/admin/products/${r.product_id}`} className="font-medium hover:underline">{r.product_name}</Link>
                  <span className="block font-mono text-[11px] text-ink-soft">{r.sku} · {r.variant_name}{r.product_status !== "published" ? ` · ${r.product_status}` : ""}</span>
                </td>
                <td className="font-mono">{r.quantity}</td>
                <td className="font-mono">{r.reserved}</td>
                <td className={`font-mono font-semibold ${r.available <= 0 ? "text-red-700" : r.available <= r.threshold ? "text-amber-700" : ""}`}>{r.available}<span className="ml-1 text-[10px] font-normal text-ink-soft">/ alert ≤{r.threshold}</span></td>
                <td className="font-mono">{r.incoming}</td>
                <td className="font-mono text-xs">{r.supplier_reported ?? "—"}{r.supplier_reported_at && <span className="block text-[10px] text-ink-soft">{fmtDate(r.supplier_reported_at, false)}</span>}</td>
                <td className="min-w-64">
                  {canAdjust && (
                    <details>
                      <summary className="cursor-pointer text-sm text-brand">Change…</summary>
                      <div className="mt-2 space-y-3 rounded-xl bg-cream p-3">
                        <ActionForm action={adjustStockAction} submitLabel="Set on-hand">
                          <input type="hidden" name="variantId" value={r.variant_id} />
                          <div className="flex gap-2">
                            <input name="quantity" type="number" min={r.reserved} defaultValue={r.quantity} aria-label="New on-hand quantity" className="admin-input !w-24 font-mono" />
                            <input name="reason" required placeholder="Reason (required)" aria-label="Reason" className="admin-input" />
                          </div>
                        </ActionForm>
                        <ActionForm action={incomingAction} submitLabel="Save incoming / supplier stock" variant="ghost">
                          <input type="hidden" name="variantId" value={r.variant_id} />
                          <div className="flex gap-2">
                            <input name="incoming" type="number" min={0} defaultValue={r.incoming} aria-label="Incoming" className="admin-input !w-24 font-mono" />
                            <input name="supplierReported" type="number" min={0} defaultValue={r.supplier_reported ?? ""} placeholder="Supplier qty" aria-label="Supplier-reported quantity" className="admin-input !w-28 font-mono" />
                          </div>
                          <input name="reason" placeholder="Note (e.g. PO #123)" aria-label="Note" className="admin-input" />
                        </ActionForm>
                      </div>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination page={page} total={total} pageSize={50} params={sp} />
      </Card>

      <Card title="Recent stock movements" className="mt-6" pad={false}>
        {moves.length === 0 ? <p className="p-5 text-sm text-ink-soft">No movements yet.</p> : (
          <Table head={["When", "SKU", "Kind", "On hand", "Reserved", "Reason", "By"]}>
            {moves.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap text-xs text-ink-soft">{fmtDate(m.created_at)}</td>
                <td className="font-mono text-xs">{m.sku}</td>
                <td className="text-xs">{m.kind}</td>
                <td className="font-mono text-xs">{m.quantity_before} → {m.quantity_after}</td>
                <td className="font-mono text-xs">{m.reserved_before} → {m.reserved_after}</td>
                <td className="text-xs">{m.reason}{m.order_id && <Link className="ml-1 text-brand underline" href={`/admin/orders/${m.order_id}`}>#{m.order_number}</Link>}</td>
                <td className="text-xs text-ink-soft">{m.admin_email ?? (m.order_id ? "system" : "—")}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

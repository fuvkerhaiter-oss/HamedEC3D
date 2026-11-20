import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, Field, fmtDate, fmtMoney, PageHeader, Table } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { listMappings, listSuppliers } from "@/lib/admin/services/suppliers";
import { getSql } from "@/lib/db/client";
import { adapterInfo } from "@/lib/suppliers/registry";
import { deleteMappingAction, saveMappingAction } from "../../ops-actions";
import { SupplierForm } from "@/features/admin/SupplierForm";

export const metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePage("suppliers.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sql = getSql();
  const s = (await listSuppliers(sql)).find((x) => x.id === id);
  if (!s) notFound();
  const mappings = await listMappings(sql, id);
  const canManage = session.permissions.has("suppliers.manage");
  const showCost = session.permissions.has("products.costs");
  const info = adapterInfo(s.adapter_key);
  return (
    <>
      <PageHeader eyebrow="Supplier" title={s.name} description={<span className="flex flex-wrap gap-2"><Badge tone={s.fulfillment_mode === "api" ? "blue" : "gray"}>{s.fulfillment_mode}</Badge>{s.is_mock && <Badge tone="ink">mock</Badge>}<span>{info.label}: {info.detail}</span></span>} actions={<Link className="btn-ghost" href="/admin/suppliers">← Suppliers</Link>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={`Product mapping (${mappings.length})`} pad={false} className="xl:col-span-2">
          {mappings.length === 0 ? <p className="p-5 text-sm text-ink-soft">No SKUs mapped yet. Orders containing unmapped items are flagged for manual handling.</p> : (
            <Table head={["Our SKU", "Product", "Supplier SKU", showCost ? "Unit cost" : "", "Ships in", "Primary", "Synced", ""]}>
              {mappings.map((m) => (
                <tr key={m.id}>
                  <td className="font-mono text-xs">{m.sku}</td>
                  <td><Link className="hover:underline" href={`/admin/products/${m.product_id}`}>{m.product_name}</Link> <span className="text-ink-soft">· {m.variant_name}</span></td>
                  <td className="font-mono text-xs">{m.supplier_sku}</td>
                  <td className="font-mono">{showCost ? fmtMoney(m.cost_amount, m.cost_currency) : ""}</td>
                  <td className="text-xs">{m.shipping_days_min ?? "?"}–{m.shipping_days_max ?? "?"} d</td>
                  <td>{m.is_primary ? <Badge tone="green">primary</Badge> : ""}</td>
                  <td className="text-xs text-ink-soft">{m.last_synced_at ? fmtDate(m.last_synced_at) : "manual"}</td>
                  <td>{canManage && <ActionForm action={deleteMappingAction} inline hideMessage confirm="Remove this mapping?"><input type="hidden" name="supplierId" value={id} /><input type="hidden" name="mappingId" value={m.id} /><button className="btn-danger !px-2 !py-0.5 text-xs">Remove</button></ActionForm>}</td>
                </tr>
              ))}
            </Table>
          )}
          {canManage && (
            <div className="border-t border-line p-5">
              <ActionForm action={saveMappingAction} submitLabel="Save mapping" resetOnSuccess>
                <input type="hidden" name="supplierId" value={id} />
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Our SKU"><input name="sku" required className="admin-input font-mono" /></Field>
                  <Field label="Supplier SKU"><input name="supplierSku" required className="admin-input font-mono" /></Field>
                  <Field label="Unit cost"><input name="cost" inputMode="decimal" required className="admin-input font-mono" /></Field>
                  <Field label="Currency"><select name="costCurrency" defaultValue={s.default_currency} className="admin-input"><option>EUR</option><option>USD</option></select></Field>
                  <Field label="Ships in (min days)"><input name="daysMin" inputMode="numeric" className="admin-input" /></Field>
                  <Field label="Ships in (max days)"><input name="daysMax" inputMode="numeric" className="admin-input" /></Field>
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPrimary" defaultChecked className="h-4 w-4" /> Primary supplier for this SKU</label>
              </ActionForm>
            </div>
          )}
        </Card>
        {canManage && <Card title="Details"><SupplierForm s={s} /></Card>}
      </div>
    </>
  );
}

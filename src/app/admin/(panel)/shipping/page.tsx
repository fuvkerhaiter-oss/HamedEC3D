import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, EmptyState, Field, fmtMoney, Notice, PageHeader } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { loadShippingZones } from "@/lib/admin/services/shipping";
import { getSql } from "@/lib/db/client";
import { toDecimalString } from "@/lib/money";
import type { ShippingMethodConfig } from "@/lib/shipping/quote";
import { deleteShippingAction, saveMethodAction, saveZoneAction } from "../ops-actions";

export const metadata = { title: "Shipping & Delivery" };

const dec = (n: number | null, c: "EUR" | "USD") => (n === null ? "" : toDecimalString({ amount: n, currency: c }));

function tiersText(m: ShippingMethodConfig) {
  return m.rates.map((r) => {
    const b = (v: number) => (m.rateType === "weight" ? String(v) : dec(v, m.currency as "EUR" | "USD"));
    return `${b(r.minValue)}-${r.maxValue === null ? "" : b(r.maxValue)}: ${dec(r.amount, m.currency as "EUR" | "USD")}`;
  }).join("\n");
}

function MethodForm({ zoneId, m }: { zoneId: string; m?: ShippingMethodConfig }) {
  const cur = (m?.currency ?? "EUR") as "EUR" | "USD";
  return (
    <ActionForm action={saveMethodAction} submitLabel={m ? "Save method" : "Add method"} resetOnSuccess={!m}>
      <input type="hidden" name="zoneId" value={zoneId} />
      {m && <input type="hidden" name="id" value={m.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><input name="name" defaultValue={m?.name} required placeholder="Standard" className="admin-input" /></Field>
        <Field label="Carrier"><input name="carrier" defaultValue={m?.carrier ?? ""} placeholder="e.g. BRT, DHL" className="admin-input" /></Field>
        <Field label="Currency"><select name="currency" defaultValue={cur} className="admin-input"><option>EUR</option><option>USD</option></select></Field>
        <Field label="Rate type">
          <select name="rateType" defaultValue={m?.rateType ?? "fixed"} className="admin-input">
            <option value="fixed">Fixed price</option><option value="weight">By weight (grams)</option><option value="order_value">By order value</option>
          </select>
        </Field>
        <Field label="Fixed price"><input name="fixedAmount" inputMode="decimal" defaultValue={dec(m?.fixedAmount ?? null, cur)} className="admin-input font-mono" /></Field>
        <Field label="Free over (order value)"><input name="freeOverAmount" inputMode="decimal" defaultValue={dec(m?.freeOverAmount ?? null, cur)} placeholder="no free shipping" className="admin-input font-mono" /></Field>
        <Field label="Min days"><input name="minDays" inputMode="numeric" defaultValue={m?.minDays ?? ""} className="admin-input" /></Field>
        <Field label="Max days"><input name="maxDays" inputMode="numeric" defaultValue={m?.maxDays ?? ""} className="admin-input" /></Field>
      </div>
      <Field label="Tiers (weight / order-value methods)" hint="One per line: “min-max: price”. Leave max empty for “and above”. Weight in grams (0-2000: 6.90), order value in money (0-49.99: 7.99).">
        <textarea name="tiers" rows={3} defaultValue={m ? tiersText(m) : ""} className="admin-input font-mono text-xs" />
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={m?.isActive ?? true} className="h-4 w-4" /> Active</label>
    </ActionForm>
  );
}

export default async function ShippingPage() {
  await requirePage("shipping.manage");
  const zones = await loadShippingZones(getSql(), { includeInactive: true });
  return (
    <>
      <PageHeader title="Shipping prices" description="Where you deliver and what delivery costs. Make an area (countries) → add a delivery option → set its price." />
      {zones.length === 0 && <div className="mb-4"><Notice tone="warn" title="No shipping configured">Orders can&apos;t be placed until at least one zone and method exist for the destination.</Notice></div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {zones.length === 0 && <EmptyState title="No zones yet">Create e.g. “Italy”, “EU”, “USA”.</EmptyState>}
          {zones.map((z) => (
            <Card key={z.id} title={<span className="flex flex-wrap items-center gap-2">{z.name} {!z.isActive && <Badge>inactive</Badge>}<span className="font-mono text-xs font-normal text-ink-soft">{z.countries.join(" ")}</span></span>}>
              <ul className="space-y-2">
                {z.methods.map((m) => (
                  <li key={m.id}>
                    <details className="rounded-xl border border-line">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                        <span className="font-medium">{m.name}</span>{m.carrier && <span className="text-ink-soft">{m.carrier}</span>}
                        <Badge>{m.rateType.replace("_", " ")}</Badge>{!m.isActive && <Badge>inactive</Badge>}
                        <span className="ml-auto font-mono text-xs">
                          {m.rateType === "fixed" ? fmtMoney(m.fixedAmount, m.currency) : `${m.rates.length} tier(s)`}{m.freeOverAmount !== null && ` · free ≥ ${fmtMoney(m.freeOverAmount, m.currency)}`}{m.minDays !== null && ` · ${m.minDays}–${m.maxDays ?? "?"} d`}
                        </span>
                      </summary>
                      <div className="space-y-3 border-t border-line p-4">
                        <MethodForm zoneId={z.id} m={m} />
                        <ActionForm action={deleteShippingAction} inline confirm={`Delete ${m.name}?`}><input type="hidden" name="kind" value="method" /><input type="hidden" name="id" value={m.id} /><button className="btn-danger">Delete method</button></ActionForm>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
              <details className="mt-3 rounded-xl border border-dashed border-line">
                <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">+ Add method</summary>
                <div className="border-t border-line p-4"><MethodForm zoneId={z.id} /></div>
              </details>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-ink-soft">Edit zone</summary>
                <ActionForm action={saveZoneAction} submitLabel="Save zone" className="mt-2">
                  <input type="hidden" name="id" value={z.id} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Name"><input name="name" defaultValue={z.name} required className="admin-input" /></Field>
                    <Field label="Countries"><input name="countries" defaultValue={z.countries.join(" ")} required className="admin-input font-mono" /></Field>
                    <Field label="Sort"><input name="sortOrder" inputMode="numeric" defaultValue={z.sortOrder ?? 0} className="admin-input" /></Field>
                  </div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={z.isActive} className="h-4 w-4" /> Active</label>
                </ActionForm>
                <ActionForm action={deleteShippingAction} inline confirm={`Delete zone ${z.name} and its methods?`} className="mt-2"><input type="hidden" name="kind" value="zone" /><input type="hidden" name="id" value={z.id} /><button className="btn-danger">Delete zone</button></ActionForm>
              </details>
            </Card>
          ))}
        </div>
        <Card title="New zone">
          <ActionForm action={saveZoneAction} submitLabel="Add zone" resetOnSuccess>
            <Field label="Name"><input name="name" required placeholder="EU" className="admin-input" /></Field>
            <Field label="Countries" hint="ISO codes separated by spaces or commas, e.g. IT FR DE ES"><input name="countries" required className="admin-input font-mono" /></Field>
            <Field label="Sort order"><input name="sortOrder" inputMode="numeric" defaultValue={0} className="admin-input" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked className="h-4 w-4" /> Active</label>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

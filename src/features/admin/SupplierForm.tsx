import { ActionForm } from "@/features/admin/ActionForm";
import { Field } from "@/features/admin/ui";
import type { SupplierRow } from "@/lib/admin/services/suppliers";
import { ADAPTERS } from "@/lib/suppliers/registry";
import { saveSupplierAction } from "@/app/admin/(panel)/ops-actions";

export function SupplierForm({ s }: { s?: SupplierRow }) {
  return (
    <ActionForm action={saveSupplierAction} submitLabel={s ? "Save supplier" : "Add supplier"} resetOnSuccess={!s}>
      {s && <input type="hidden" name="id" value={s.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input name="name" defaultValue={s?.name} required className="admin-input" /></Field>
        <Field label="Contact email"><input name="contactEmail" type="email" defaultValue={s?.contact_email ?? ""} className="admin-input" /></Field>
        <Field label="Fulfillment mode" hint="API mode needs a real adapter built from the supplier's API docs">
          <select name="fulfillmentMode" defaultValue={s?.fulfillment_mode ?? "manual"} className="admin-input"><option value="manual">Manual</option><option value="api">API</option></select>
        </Field>
        <Field label="Adapter">
          <select name="adapterKey" defaultValue={s?.adapter_key ?? "manual"} className="admin-input">
            {ADAPTERS.filter((a) => a.available || a.key === s?.adapter_key).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </Field>
        <Field label="Website"><input name="website" defaultValue={s?.website ?? ""} className="admin-input" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cost currency"><select name="defaultCurrency" defaultValue={s?.default_currency ?? "EUR"} className="admin-input"><option>EUR</option><option>USD</option></select></Field>
          <Field label="Lead time (days)"><input name="leadTimeDays" inputMode="numeric" defaultValue={s?.lead_time_days ?? ""} className="admin-input" /></Field>
        </div>
      </div>
      <Field label="Notes"><textarea name="notes" rows={2} defaultValue={s?.notes} className="admin-input" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={s?.is_active ?? true} className="h-4 w-4" /> Active</label>
    </ActionForm>
  );
}


import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, Field, Notice, PageHeader } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { getSettings } from "@/lib/admin/services/settings";
import { getSql } from "@/lib/db/client";
import { toDecimalString } from "@/lib/money";
import { ownPasswordAction, settingsAction, taxRateAction } from "../ops-actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePage("settings.manage");
  const sql = getSql();
  const [s, taxes] = await Promise.all([
    getSettings(sql),
    sql<{ id: string; country: string; region: string | null; mode: string; basis_points: number; is_active: boolean; note: string | null }[]>`select * from public.tax_rates order by country, region nulls first`,
  ]);
  const seller = (s["store.seller"] ?? {}) as Record<string, string>;
  const str = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : "");
  return (
    <>
      <PageHeader title="Shop settings" description="Your business details, taxes and password. Every change is saved in the change history." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Store">
          <ActionForm action={settingsAction} submitLabel="Save settings">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Store name"><input name="storeName" defaultValue={str("store.name") || "Mega Market"} required className="admin-input" /></Field>
              <Field label="Support email"><input name="supportEmail" type="email" defaultValue={str("store.support_email")} className="admin-input" /></Field>
              <Field label="Base (reporting) currency" hint="Changing it affects reports only; orders keep their own currency and rate snapshot.">
                <select name="baseCurrency" defaultValue={str("store.base_currency") || "EUR"} className="admin-input"><option>EUR</option><option>USD</option></select>
              </Field>
              <Field label="Default low-stock alert"><input name="lowStock" type="number" min={0} defaultValue={Number(s["store.default_low_stock_threshold"] ?? 5)} className="admin-input" /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="stockAllFaces" defaultChecked={s["store.stock_all_faces"] === true} className="h-4 w-4" /> 3D store: stock every aisle (otherwise only the benchmark aisle + pinned faces)</label>
            <h3 className="pt-2 text-sm font-semibold">Seller details (printed on invoices)</h3>
            <p className="text-xs text-ink-soft">Fill in your real company data. Invoices can&apos;t be issued until legal name and address are set.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Legal name"><input name="legalName" defaultValue={seller.legalName} className="admin-input" /></Field>
              <Field label="VAT number"><input name="vatNumber" defaultValue={seller.vatNumber} className="admin-input font-mono" /></Field>
              <Field label="Invoice email"><input name="sellerEmail" type="email" defaultValue={seller.email} className="admin-input" /></Field>
            </div>
            <Field label="Registered address"><textarea name="address" rows={3} defaultValue={seller.address} className="admin-input" /></Field>
          </ActionForm>
        </Card>
        <div className="space-y-4">
          <Card title="Tax rates">
            <Notice tone="warn">Rates must be confirmed by your accountant (Italy/EU OSS, US state nexus). Checkout refuses destinations without an active rate.</Notice>
            <ul className="mt-3 divide-y divide-line text-sm">
              {taxes.map((t) => (
                <li key={t.id} className="py-2">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2"><span className="font-mono">{t.country}{t.region ? `-${t.region}` : ""}</span><span>{toDecimalString({ amount: t.basis_points, currency: "EUR" })}%</span><Badge>{t.mode}</Badge>{!t.is_active && <Badge tone="red">inactive</Badge>}<span className="text-xs text-ink-soft">{t.note}</span></summary>
                    <TaxForm t={t} />
                  </details>
                </li>
              ))}
              {taxes.length === 0 && <li className="py-2 text-ink-soft">No tax rates configured.</li>}
            </ul>
            <details className="mt-3 rounded-xl border border-dashed border-line"><summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">+ Add tax rate</summary><div className="border-t border-line p-4"><TaxForm /></div></details>
          </Card>
          <Card title="Your password">
            <ActionForm action={ownPasswordAction} submitLabel="Change password" resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="New password" hint="12+ characters, letters and numbers"><input name="password" type="password" autoComplete="new-password" required className="admin-input" /></Field>
                <Field label="Confirm"><input name="confirm" type="password" autoComplete="new-password" required className="admin-input" /></Field>
              </div>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}

function TaxForm({ t }: { t?: { id: string; country: string; region: string | null; mode: string; basis_points: number; is_active: boolean; note: string | null } }) {
  return (
    <ActionForm action={taxRateAction} submitLabel={t ? "Save" : "Add rate"} className="mt-3" resetOnSuccess={!t}>
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Country"><input name="country" defaultValue={t?.country} required maxLength={2} className="admin-input font-mono uppercase" /></Field>
        <Field label="Region (US state)"><input name="region" defaultValue={t?.region ?? ""} className="admin-input font-mono uppercase" /></Field>
        <Field label="Rate %"><input name="percent" defaultValue={t ? toDecimalString({ amount: t.basis_points, currency: "EUR" }) : ""} required className="admin-input font-mono" /></Field>
        <Field label="Mode"><select name="mode" defaultValue={t?.mode ?? "inclusive"} className="admin-input"><option value="inclusive">inclusive (EU)</option><option value="exclusive">exclusive (US)</option></select></Field>
      </div>
      <Field label="Note"><input name="note" defaultValue={t?.note ?? ""} placeholder="e.g. confirmed by accountant 2026-11" className="admin-input" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={t?.is_active ?? true} className="h-4 w-4" /> Active</label>
    </ActionForm>
  );
}

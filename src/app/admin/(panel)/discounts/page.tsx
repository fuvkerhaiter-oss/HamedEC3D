import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, EmptyState, Field, fmtDate, fmtMoney, PageHeader, Table } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { listCategories } from "@/lib/admin/services/catalog-admin";
import { listCoupons } from "@/lib/admin/services/coupons";
import { getSql } from "@/lib/db/client";
import { toDecimalString } from "@/lib/money";
import { saveCouponAction } from "../ops-actions";

export const metadata = { title: "Discounts & Coupons" };

type Coupon = Awaited<ReturnType<typeof listCoupons>>[number];
const localDt = (d: Date | null) => (d ? d.toISOString().slice(0, 16) : "");

function CouponForm({ c, cats, products }: { c?: Coupon; cats: { id: string; name: string }[]; products: { id: string; name: string }[] }) {
  const cur = c?.currency ?? "";
  return (
    <ActionForm action={saveCouponAction} submitLabel={c ? "Save" : "Create code"} resetOnSuccess={!c}>
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Code"><input name="code" defaultValue={c?.code} required className="admin-input font-mono uppercase" /></Field>
        <Field label="Internal name"><input name="name" defaultValue={c?.name} className="admin-input" /></Field>
        <Field label="Type"><select name="kind" defaultValue={c?.kind ?? "percent"} className="admin-input"><option value="percent">Percent off</option><option value="fixed">Fixed amount off</option></select></Field>
        <Field label="Percent (for percent)"><input name="percent" inputMode="decimal" defaultValue={c?.basis_points ? toDecimalString({ amount: c.basis_points, currency: "EUR" }) : ""} placeholder="10" className="admin-input font-mono" /></Field>
        <Field label="Amount (for fixed)"><input name="amount" inputMode="decimal" defaultValue={c?.amount && c.currency ? toDecimalString({ amount: c.amount, currency: c.currency }) : ""} className="admin-input font-mono" /></Field>
        <Field label="Currency" hint="Required for fixed amounts and minimums"><select name="currency" defaultValue={cur} className="admin-input"><option value="">Any (percent only)</option><option>EUR</option><option>USD</option></select></Field>
        <Field label="Minimum order"><input name="minSubtotal" inputMode="decimal" defaultValue={c?.min_subtotal && c.currency ? toDecimalString({ amount: c.min_subtotal, currency: c.currency }) : ""} className="admin-input font-mono" /></Field>
        <Field label="Starts (UTC)"><input name="startsAt" type="datetime-local" defaultValue={localDt(c?.starts_at ?? null)} className="admin-input" /></Field>
        <Field label="Ends (UTC)"><input name="endsAt" type="datetime-local" defaultValue={localDt(c?.ends_at ?? null)} className="admin-input" /></Field>
        <Field label="Total uses limit"><input name="maxRedemptions" inputMode="numeric" defaultValue={c?.max_redemptions ?? ""} className="admin-input" /></Field>
        <Field label="Per-customer limit"><input name="perCustomerLimit" inputMode="numeric" defaultValue={c?.per_customer_limit ?? ""} className="admin-input" /></Field>
        <Field label="Applies to"><select name="appliesTo" defaultValue={c?.applies_to ?? "all"} className="admin-input"><option value="all">Whole order</option><option value="category">Categories</option><option value="product">Products</option></select></Field>
      </div>
      <Field label="Targets (for category/product codes)" hint="Ctrl/⌘-click to select several">
        <select name="targetIds" multiple defaultValue={c?.target_ids ?? []} className="admin-input h-28">
          <optgroup label="Categories">{cats.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
          <optgroup label="Products">{products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={c?.is_active ?? true} className="h-4 w-4" /> Active</label>
    </ActionForm>
  );
}

export default async function DiscountsPage() {
  await requirePage("discounts.manage");
  const sql = getSql();
  const [coupons, cats, products] = await Promise.all([
    listCoupons(sql),
    listCategories(sql),
    sql<{ id: string; name: string }[]>`select id, name from public.products where deleted_at is null order by name`,
  ]);
  const now = new Date();
  return (
    <>
      <PageHeader title="Discount codes" description="Codes customers type at checkout to get money off. The shop checks dates and limits for you." />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={`Codes (${coupons.length})`} pad={false} className="xl:col-span-2">
          {coupons.length === 0 ? <div className="p-5"><EmptyState title="No discount codes yet" /></div> : (
            <Table head={["Code", "Discount", "Applies to", "Used", "Window", "Status"]}>
              {coupons.map((c) => {
                const live = c.is_active && (!c.starts_at || c.starts_at <= now) && (!c.ends_at || c.ends_at > now) && (c.max_redemptions === null || c.redemption_count < c.max_redemptions);
                return (
                  <tr key={c.id}>
                    <td>
                      <details>
                        <summary className="cursor-pointer font-mono font-medium">{c.code}</summary>
                        <div className="mt-3 w-[min(80vw,720px)] rounded-xl bg-cream p-4"><CouponForm c={c} cats={cats} products={products} /></div>
                      </details>
                      {c.name && <span className="block text-xs text-ink-soft">{c.name}</span>}
                    </td>
                    <td className="font-mono">{c.kind === "percent" ? `${toDecimalString({ amount: c.basis_points ?? 0, currency: "EUR" })}%` : fmtMoney(c.amount, c.currency)}{c.min_subtotal ? <span className="block text-[11px] text-ink-soft">min {fmtMoney(c.min_subtotal, c.currency)}</span> : null}</td>
                    <td className="text-xs">{c.applies_to === "all" ? "Whole order" : `${c.target_ids.length} ${c.applies_to}(s)`}</td>
                    <td className="font-mono">{c.redemption_count}{c.max_redemptions ? ` / ${c.max_redemptions}` : ""}</td>
                    <td className="text-xs text-ink-soft">{c.starts_at ? fmtDate(c.starts_at, false) : "now"} → {c.ends_at ? fmtDate(c.ends_at, false) : "no end"}</td>
                    <td>{live ? <Badge tone="green">live</Badge> : <Badge>{c.is_active ? "not running" : "inactive"}</Badge>}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
        <Card title="New code"><CouponForm cats={cats} products={products} /></Card>
      </div>
    </>
  );
}

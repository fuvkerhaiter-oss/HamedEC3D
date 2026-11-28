import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, Field, fmtDate, fmtMoney, Notice, PageHeader, SampleBadge, StatusBadge } from "@/features/admin/ui";
import { SUPERMARKET, STORE_CONFIG } from "@/features/store3d/env/supermarket";
import { requirePage } from "@/lib/admin/guard";
import { listCategories, categoryTree } from "@/lib/admin/services/catalog-admin";
import { getProductDetail, publishProblems, type VariantDetail } from "@/lib/admin/services/products";
import { listSuppliers } from "@/lib/admin/services/suppliers";
import { getSql } from "@/lib/db/client";
import { marginBps } from "@/lib/finance/profit";
import { ProductImageManager } from "@/features/admin/images/ProductImageManager";
import { listImages, toView } from "@/lib/admin/services/images";
import { mediaStatus } from "@/lib/media/storage";
import { toDecimalString } from "@/lib/money";
import {
  deleteProductsAction, placementAction, removeVariantAction, restoreProductAction, saveProductAction, saveVariantAction, setStatusAction,
} from "../actions";
import { adjustStockAction } from "../../catalog-actions";

export const metadata = { title: "Product" };

const dec = (amount: number | null, cur: "EUR" | "USD") => (amount === null ? "" : toDecimalString({ amount, currency: cur }));

function VariantForm({ productId, v, suppliers, showCosts }: { productId: string; v?: VariantDetail; suppliers: { id: string; name: string; is_mock: boolean }[]; showCosts: boolean }) {
  return (
    <ActionForm action={saveVariantAction} submitLabel={v ? "Save variant" : "Add variant"} resetOnSuccess={!v}>
      <input type="hidden" name="productId" value={productId} />
      {v && <input type="hidden" name="id" value={v.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="SKU"><input name="sku" defaultValue={v?.sku} required className="admin-input font-mono" /></Field>
        <Field label="Name" hint="e.g. 500 ml, Red / M"><input name="name" defaultValue={v?.name} required className="admin-input" /></Field>
        <Field label="Price EUR (VAT incl.)"><input name="priceEur" inputMode="decimal" defaultValue={dec(v?.price_eur ?? null, "EUR")} placeholder="0.00" className="admin-input font-mono" /></Field>
        <Field label="Price USD (pre-tax)"><input name="priceUsd" inputMode="decimal" defaultValue={dec(v?.price_usd ?? null, "USD")} placeholder="0.00" className="admin-input font-mono" /></Field>
        <Field label="Compare-at EUR"><input name="compareEur" inputMode="decimal" defaultValue={dec(v?.compare_eur ?? null, "EUR")} className="admin-input font-mono" /></Field>
        <Field label="Compare-at USD"><input name="compareUsd" inputMode="decimal" defaultValue={dec(v?.compare_usd ?? null, "USD")} className="admin-input font-mono" /></Field>
        <Field label="Weight (g)"><input name="weightGrams" inputMode="numeric" defaultValue={v?.weight_grams ?? ""} className="admin-input font-mono" /></Field>
        <Field label="Barcode"><input name="barcode" defaultValue={v?.barcode ?? ""} className="admin-input font-mono" /></Field>
        <Field label="Attributes" hint="key=value; key=value"><input name="attributes" defaultValue={v ? Object.entries(v.attributes).map(([k, x]) => `${k}=${x}`).join("; ") : ""} className="admin-input" /></Field>
        <Field label="Low-stock alert at" hint="Warn me when only this many are left. This is NOT your stock."><input name="lowStockThreshold" inputMode="numeric" defaultValue={v?.low_stock_threshold ?? ""} placeholder="default" className="admin-input font-mono" /></Field>
        <Field label="Sort order"><input name="sortOrder" inputMode="numeric" defaultValue={v?.sort_order ?? 0} className="admin-input font-mono" /></Field>
        {!v && <Field label="How many you have (stock)" hint="0 = sold out: it can't be bought and its 3D shelf space stays empty"><input name="initialStock" inputMode="numeric" defaultValue={0} className="admin-input font-mono" /></Field>}
      </div>
      {showCosts && (
        <div className="grid gap-3 rounded-xl bg-cream p-3 sm:grid-cols-4">
          <Field label="Supplier">
            <select name="supplierId" defaultValue={v?.supplier_id ?? ""} className="admin-input">
              <option value="">— choose a category —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_mock ? " (mock)" : ""}</option>)}
            </select>
          </Field>
          <Field label="Supplier SKU"><input name="supplierSku" defaultValue={v?.supplier_sku ?? ""} className="admin-input font-mono" /></Field>
          <Field label="Unit cost"><input name="costAmount" inputMode="decimal" defaultValue={v?.cost_amount != null ? dec(v.cost_amount, v.cost_currency === "USD" ? "USD" : "EUR") : ""} className="admin-input font-mono" /></Field>
          <Field label="Cost currency">
            <select name="costCurrency" defaultValue={v?.cost_currency ?? "EUR"} className="admin-input"><option>EUR</option><option>USD</option></select>
          </Field>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={v?.is_active ?? true} className="h-4 w-4" /> Active (sellable)</label>
    </ActionForm>
  );
}

/** "How many do you have?" right on the product page (same action + movement log as Stock (Inventory)). */
function StockBox({ v, canAdjust }: { v: VariantDetail; canAdjust: boolean }) {
  const available = v.quantity - v.reserved;
  return (
    <div className={`mb-4 rounded-xl border p-3 ${available <= 0 ? "border-amber-300 bg-amber-50" : "border-line bg-cream"}`}>
      <p className="text-sm font-semibold">How many you have (stock)</p>
      <p className="mt-0.5 text-xs text-ink-soft">
        {available <= 0
          ? "Sold out right now: customers can't buy it and its space on the 3D shelf stays empty."
          : `${available} can be bought${v.reserved ? ` (${v.reserved} more are kept for unpaid orders)` : ""}.`}
      </p>
      {canAdjust ? (
        <ActionForm action={adjustStockAction} submitLabel="Save stock" className="mt-2">
          <input type="hidden" name="variantId" value={v.id} />
          <input type="hidden" name="reason" value="Set on the product page" />
          <input name="quantity" type="number" min={v.reserved} defaultValue={v.quantity} aria-label={`Stock for ${v.name}`} className="admin-input !w-32 font-mono" />
        </ActionForm>
      ) : (
        <p className="mt-2 font-mono text-sm">{v.quantity}</p>
      )}
    </div>
  );
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePage("products.view");
  const { id } = await params;
  const sql = getSql();
  const isNew = id === "new";
  if (isNew && !session.permissions.has("products.edit")) return notFound();
  const [detail, cats, suppliers] = await Promise.all([isNew ? null : getProductDetail(sql, id), listCategories(sql), listSuppliers(sql)]);
  if (!isNew && !detail) notFound();
  const p = detail?.product;
  const problems = p ? await publishProblems(sql, p.id) : [];
  const can = (x: Parameters<typeof session.permissions.has>[0]) => session.permissions.has(x);
  const showCosts = can("products.costs");
  const images = p ? await listImages(sql, p.id) : [];

  return (
    <>
      <PageHeader
        title={isNew ? "New product" : p!.name}
        description={
          !isNew && (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge status={p!.deleted_at ? "deleted" : p!.status} />
              {p!.is_mock && <SampleBadge />}
              <span>Updated {fmtDate(p!.updated_at)}</span>
              {detail!.orderCount > 0 && <Badge tone="blue">Bought in {detail!.orderCount} order(s)</Badge>}
              {p!.status === "published" && <Link className="text-brand underline" href={`/catalog`} target="_blank">See it in the shop<ArrowUpRight aria-hidden className="ml-1 inline h-4 w-4 align-[-3px]" /></Link>}
            </span>
          )
        }
        actions={<Link href="/admin/products" className="btn-ghost">← Back to products</Link>}
      />
      {(isNew || (p && p.status !== "published" && !p.deleted_at)) && (
        <div className="mb-4">
          <Notice tone="info" title="How to put a product in your shop">
            <ol className="mt-1 list-inside list-decimal space-y-0.5">
              <li className={isNew ? "font-semibold" : "text-ink-soft line-through"}>Type a name, pick a category and press “Create product”.</li>
              <li className={!isNew && detail!.variants.length === 0 ? "font-semibold" : ""}>Under “Sizes & prices”, add at least one size or option with its price and how many you have.</li>
              <li>Add photos (optional but recommended).</li>
              <li>Press “Publish” on the right. Customers can now see and buy it.</li>
            </ol>
          </Notice>
        </div>
      )}
      {p && p.status === "published" && !p.deleted_at && detail!.variants.length > 0 && detail!.variants.every((v) => !v.is_active || v.quantity - v.reserved <= 0) && (
        <div className="mb-4"><Notice tone="warn" title="Nothing in stock">
          This product is live but sold out, so customers can&apos;t buy it and it isn&apos;t shown on the 3D shelves (only an empty space with a “Sold out” tag). Type how many you have in “How many you have (stock)” under Sizes &amp; prices and press “Save stock”.
        </Notice></div>
      )}
      {p?.is_mock && <div className="mb-4"><Notice tone="warn" title="Sample product">This is an example product (customers see a “Sample” label). Replace it with your real products before opening the shop.</Notice></div>}
      {p?.deleted_at && (
        <div className="mb-4"><Notice tone="bad" title="Deleted">This product was deleted on {fmtDate(p.deleted_at)} and is only kept so old orders still show it.
          {can("products.delete") && <ActionForm action={restoreProductAction} inline className="mt-2"><input type="hidden" name="id" value={p.id} /><button className="btn-ghost">Restore as draft</button></ActionForm>}
        </Notice></div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Product information">
            <fieldset disabled={!can("products.edit")}>
              <ActionForm action={saveProductAction} submitLabel={isNew ? "Create product" : "Save details"}>
                {p && <input type="hidden" name="id" value={p.id} />}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name"><input name="name" defaultValue={p?.name} required maxLength={200} className="admin-input" /></Field>
                  <Field label="Web address name" hint="Part of the page link, e.g. olive-oil. Leave empty and it's made from the name."><input name="slug" defaultValue={p?.slug} className="admin-input font-mono" /></Field>
                  <Field label="Category">
                    <select name="categoryId" defaultValue={p?.category_id ?? ""} className="admin-input">
                      <option value="">— choose a category —</option>
                      {categoryTree(cats).map((c) => <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.name}{c.is_active ? "" : " (inactive)"}</option>)}
                    </select>
                  </Field>
                  <Field label="Brand" hint="Optional"><input name="brand" defaultValue={p?.brand ?? ""} className="admin-input" /></Field>
                </div>
                <Field label="Description" hint="What customers read on the product page"><textarea name="description" defaultValue={p?.description} rows={5} className="admin-input" /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Search words (tags)" hint="Optional. Separate with commas, e.g. vegan, organic"><input name="tags" defaultValue={p?.tags.join(", ")} className="admin-input" /></Field>
                  <Field label="Google title" hint="Optional. The title shown in Google results"><input name="seoTitle" defaultValue={p?.seo_title ?? ""} className="admin-input" /></Field>
                </div>
                <Field label="Google description" hint="Optional. The short text shown under the title in Google"><textarea name="seoDescription" defaultValue={p?.seo_description ?? ""} rows={2} className="admin-input" /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isFeatured" defaultChecked={p?.is_featured} className="h-4 w-4" /> Show on the homepage (featured)</label>
              </ActionForm>
            </fieldset>
          </Card>

          {p && (
            <Card title={`Sizes & prices (${detail!.variants.length})`}>
              <p className="-mt-1 mb-3 text-sm text-ink-soft">Each size or option (for example “500 g” and “1 kg”) has its own price and stock. A product needs at least one.</p>
              <div className="space-y-3">
                {detail!.variants.map((v) => {
                  const m = v.price_eur !== null && v.cost_amount !== null && v.cost_currency === "EUR" ? marginBps(v.price_eur, v.cost_amount) : v.price_usd !== null && v.cost_amount !== null && v.cost_currency === "USD" ? marginBps(v.price_usd, v.cost_amount) : null;
                  return (
                    <details key={v.id} className="group rounded-xl border border-line" open={v.quantity - v.reserved <= 0 || detail!.variants.length === 1}>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 text-sm">
                        <span className="font-mono text-xs">{v.sku}</span>
                        <span className="font-medium">{v.name}</span>
                        {!v.is_active && <Badge>turned off</Badge>}
                        <span className="ml-auto flex flex-wrap items-center gap-3 font-mono text-xs text-ink-soft">
                          <span>{fmtMoney(v.price_eur, "EUR")}</span><span>{fmtMoney(v.price_usd, "USD")}</span>
                          <span className={v.quantity - v.reserved <= 0 ? "text-red-700" : ""}>{v.quantity - v.reserved} available{v.reserved ? ` · ${v.reserved} kept for unpaid orders` : ""}</span>
                          {showCosts && m !== null && <span title="Margin on listed price (EUR prices include VAT)">{(m / 100).toFixed(1)}% profit</span>}
                        </span>
                      </summary>
                      <div className="border-t border-line p-4">
                        <StockBox v={v} canAdjust={can("inventory.adjust") && !p.deleted_at} />
                        <fieldset disabled={!can("products.edit")}><VariantForm productId={p.id} v={v} suppliers={suppliers} showCosts={showCosts} /></fieldset>
                        <p className="mt-3 text-xs text-ink-soft">Stock history and all products at once: <Link className="underline" href={`/admin/inventory?q=${encodeURIComponent(v.sku)}`}>Stock (Inventory)</Link>.</p>
                        {can("products.edit") && (
                          <ActionForm action={removeVariantAction} inline className="mt-3" confirm={`Remove ${v.name} (${v.sku})?`}>
                            <input type="hidden" name="productId" value={p.id} /><input type="hidden" name="variantId" value={v.id} />
                            <button className="btn-danger">{v.ordered ? "Turn off (it has orders)" : "Delete this size/option"}</button>
                          </ActionForm>
                        )}
                      </div>
                    </details>
                  );
                })}
                {can("products.edit") && !p.deleted_at && (
                  <details className="rounded-xl border border-dashed border-line" open={detail!.variants.length === 0}>
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium">+ Add a size / option with price</summary>
                    <div className="border-t border-line p-4"><VariantForm productId={p.id} suppliers={suppliers} showCosts={showCosts} /></div>
                  </details>
                )}
              </div>
            </Card>
          )}

          {p && (
            <div id="images" className="scroll-mt-20"><Card title={`Images (${images.length})`} actions={<Link href="/admin/products/images" className="text-sm text-brand">All product photos →</Link>}>
              <ProductImageManager productId={p.id} productName={p.name} images={images.map((im) => toView(im))} canEdit={can("products.edit") && !p.deleted_at} storageNote={mediaStatus()} />
            </Card></div>
          )}
        </div>

        {p && (
          <div className="space-y-4">
            <Card title="Can customers see it?">
              <p className="text-sm">Right now: <StatusBadge status={p.status} /></p>
              {problems.length > 0 && <p className="mt-3 text-sm font-medium text-amber-900">Before you can publish:</p>}
              {problems.length > 0 && <ul className="mt-1 list-inside list-disc text-sm text-amber-800">{problems.map((x) => <li key={x}>{x}</li>)}</ul>}
              {can("products.publish") && !p.deleted_at && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {(["published", "draft", "archived"] as const).filter((s) => s !== p.status).map((s) => (
                    <ActionForm key={s} action={setStatusAction} inline>
                      <input type="hidden" name="ids" value={p.id} /><input type="hidden" name="status" value={s} />
                      <button className={s === "published" ? "btn-primary" : "btn-ghost"} disabled={s === "published" && problems.length > 0}>
                        {s === "published" ? "Publish" : s === "draft" ? "Hide (back to draft)" : "Archive"}
                      </button>
                    </ActionForm>
                  ))}
                </div>
              )}
            </Card>

            <Card title="3D shelf">
              <ActionForm action={placementAction} submitLabel="Save shelf">
                <fieldset disabled={!can("store.manage")} className="space-y-3">
                  <input type="hidden" name="productId" value={p.id} />
                  <Field label="Which shelf" hint="“Automatic” puts it next to the other products of its category. Most of the time, keep Automatic.">
                    <select name="faceId" defaultValue={detail!.placement?.face_id ?? ""} className="admin-input">
                      <option value="">Automatic (recommended)</option>
                      {SUPERMARKET.faces.map((f) => <option key={f.id} value={f.id}>{f.id}{(STORE_CONFIG.benchmarkFaces as readonly string[]).includes(f.id) ? " (benchmark aisle)" : ""}</option>)}
                    </select>
                  </Field>
                  <Field label="Position on the shelf" hint="Bigger number = shown earlier. Leave 0 if unsure."><input name="priority" type="number" min={-1000} max={1000} defaultValue={detail!.placement?.priority ?? 0} className="admin-input font-mono" /></Field>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="hiddenInStore" defaultChecked={detail!.placement?.hidden_in_store} className="h-4 w-4" /> Don&apos;t show it on the 3D shelves (still sold in the online shop)</label>
                </fieldset>
              </ActionForm>
              <p className="mt-3 text-xs text-ink-soft">3D model: {detail!.assets.find((a) => a.is_primary) ? `added (${detail!.assets[0]!.height_m} m tall)` : "none yet — a box with the product photo is shown on the shelf."}</p>
            </Card>

            {can("products.delete") && !p.deleted_at && (
              <Card title="Delete">
                <p className="text-sm text-ink-soft">{detail!.orderCount > 0 ? "Customers already bought this product, so it will be hidden everywhere but kept for old orders." : "Nobody has bought this product yet, so it will be removed for good."}</p>
                <ActionForm action={deleteProductsAction} inline className="mt-3" confirm="Delete this product?">
                  <input type="hidden" name="ids" value={p.id} /><input type="hidden" name="redirectTo" value="list" />
                  <button className="btn-danger">Delete product</button>
                </ActionForm>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}

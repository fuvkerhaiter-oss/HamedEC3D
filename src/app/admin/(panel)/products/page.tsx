import Link from "next/link";
import { ActionForm } from "@/features/admin/ActionForm";
import { BulkBar, BulkProvider, SelectAll, SelectedIds, SelectRow } from "@/features/admin/BulkTable";
import { Badge, Card, EmptyState, fmtDate, fmtMoney, PageHeader, Pagination, SampleBadge, StatusBadge, Table, CsvLink } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { listCategories } from "@/lib/admin/services/catalog-admin";
import { listProducts, type ProductStatus } from "@/lib/admin/services/products";
import { getSql } from "@/lib/db/client";
import { bulkCategoryAction, deleteProductsAction, importCsvAction, setStatusAction } from "./actions";

export const metadata = { title: "Products" };

const TABS = [
  ["", "All"], ["published", "Published"], ["draft", "Draft"], ["archived", "Archived"], ["deleted", "Deleted"],
] as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePage("products.view");
  const sp = await searchParams;
  const sql = getSql();
  const page = Number(sp.page) || 1;
  const status = (TABS.some(([k]) => k === sp.status) ? sp.status || undefined : undefined) as ProductStatus | "deleted" | undefined;
  const stock = sp.stock === "low" || sp.stock === "out" ? sp.stock : undefined;
  const categoryId = sp.category && /^[0-9a-f-]{36}$/.test(sp.category) ? sp.category : undefined;
  const [{ rows, total }, cats] = await Promise.all([
    listProducts(sql, { q: sp.q, status, categoryId, stock, page, pageSize: 25 }),
    listCategories(sql),
  ]);
  const can = (p: Parameters<typeof session.permissions.has>[0]) => session.permissions.has(p);
  const qs = (patch: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { ...sp, page: undefined, ...patch };
    return "?" + new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => !!e[1])).toString();
  };

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Products"
        description="The same products the catalog page and the 3D store show. Only published products are visible to shoppers."
        actions={
          <>
            {can("products.import") && <CsvLink href="/api/admin/export/products" className="btn-ghost">Export CSV</CsvLink>}
            <Link href="/admin/products/images" className="btn-ghost">Image Manager</Link>
            {can("products.edit") && <Link href="/admin/products/new" className="btn-primary">+ New product</Link>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap gap-1" aria-label="Status">
          {TABS.map(([k, label]) => (
            <Link key={k} href={qs({ status: k || undefined })} className={`rounded-full px-3 py-1.5 text-sm ${(sp.status ?? "") === k ? "bg-ink text-cream" : "text-ink-soft hover:bg-sand/60"}`}>{label}</Link>
          ))}
        </nav>
        <form className="ml-auto flex flex-wrap gap-2">
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <input name="q" defaultValue={sp.q} placeholder="Name, slug, SKU or barcode" className="admin-input !w-56 !py-1.5" aria-label="Search products" />
          <select name="category" defaultValue={sp.category ?? ""} className="admin-input !w-auto !py-1.5" aria-label="Category">
            <option value="">All categories</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="stock" defaultValue={sp.stock ?? ""} className="admin-input !w-auto !py-1.5" aria-label="Stock">
            <option value="">Any stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
          <button className="btn-ghost !py-1.5">Filter</button>
        </form>
      </div>

      <BulkProvider ids={rows.map((r) => r.id)}>
        <BulkBar>
          {can("products.publish") && (
            <>
              <ActionForm action={setStatusAction} inline hideMessage={false}><SelectedIds /><input type="hidden" name="status" value="published" /><button className="btn-ghost">Publish</button></ActionForm>
              <ActionForm action={setStatusAction} inline><SelectedIds /><input type="hidden" name="status" value="draft" /><button className="btn-ghost">Unpublish</button></ActionForm>
              <ActionForm action={setStatusAction} inline><SelectedIds /><input type="hidden" name="status" value="archived" /><button className="btn-ghost">Archive</button></ActionForm>
            </>
          )}
          {can("products.edit") && (
            <ActionForm action={bulkCategoryAction} inline>
              <SelectedIds />
              <select name="categoryId" className="admin-input !w-auto text-ink" aria-label="Move to category">
                <option value="">No category</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className="btn-ghost">Move</button>
            </ActionForm>
          )}
          {can("products.delete") && (
            <ActionForm action={deleteProductsAction} inline confirm="Delete the selected products? Ordered products are kept (soft-deleted) for order history.">
              <SelectedIds /><button className="btn-danger">Delete</button>
            </ActionForm>
          )}
        </BulkBar>
        <Card pad={false}>
          {rows.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No products match" action={can("products.edit") ? <Link className="btn-primary" href="/admin/products/new">Create a product</Link> : undefined}>
                Try another filter, or add your first real product.
              </EmptyState>
            </div>
          ) : (
            <Table head={[<SelectAll key="a" />, "Product", "Status", "Category", "Variants", "Available", "Price EUR", "Price USD", "Updated"]}>
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-cream/60">
                  <td className="w-8"><SelectRow id={p.id} label={p.name} /></td>
                  <td className="min-w-56">
                    <Link href={`/admin/products/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                    <span className="ml-2 inline-flex gap-1">{p.is_mock && <SampleBadge />}{p.is_featured && <Badge tone="blue">Featured</Badge>}</span>
                    <span className="block font-mono text-[11px] text-ink-soft">{p.slug}</span>
                  </td>
                  <td><StatusBadge status={p.deleted_at ? "deleted" : p.status} /></td>
                  <td className="text-ink-soft">{p.category_name ?? "—"}</td>
                  <td className="font-mono">{p.variant_count}</td>
                  <td className={`font-mono ${p.available === 0 ? "text-red-700" : ""}`}>{p.available}</td>
                  <td className="font-mono">{fmtMoney(p.min_price_eur, "EUR")}</td>
                  <td className="font-mono">{fmtMoney(p.min_price_usd, "USD")}</td>
                  <td className="whitespace-nowrap text-xs text-ink-soft">{fmtDate(p.updated_at, false)}</td>
                </tr>
              ))}
            </Table>
          )}
          <Pagination page={page} total={total} pageSize={25} params={sp} />
        </Card>
      </BulkProvider>

      {can("products.import") && (
        <Card title="Import products from CSV" className="mt-6">
          <p className="mb-3 text-sm text-ink-soft">
            Columns: <code className="text-xs">product_slug, product_name, category_slug, status, description, brand, tags, variant_sku, variant_name, price_eur, price_usd, stock, weight_grams, barcode</code>.
            Rows are matched by slug and SKU. Every row is validated first; if any row is invalid nothing is written. Stock changes are logged as inventory movements.
            Tip: export first to get a correctly formatted file.
          </p>
          <ActionForm action={importCsvAction} submitLabel="Import">
            <div className="flex flex-wrap items-center gap-4">
              <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="dryRun" defaultChecked className="h-4 w-4" /> Dry run (validate only)</label>
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}

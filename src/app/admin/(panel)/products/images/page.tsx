import Link from "next/link";
import { ActionForm } from "@/features/admin/ActionForm";
import { ImageManagerGrid } from "@/features/admin/images/ImageManagerGrid";
import { EmptyState, Notice, PageHeader, Pagination } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { listCategories } from "@/lib/admin/services/catalog-admin";
import { listForImageManager } from "@/lib/admin/services/images";
import { publicStorageUrl } from "@/lib/catalog/source-map";
import { getSql } from "@/lib/db/client";
import { mediaStatus } from "@/lib/media/storage";
import { cleanupStorageAction } from "../image-actions";

export const metadata = { title: "Product Image Manager" };

const FILTERS = [["", "All products"], ["missing", "Missing images"], ["multiple", "Multiple images"]] as const;

export default async function ImageManagerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePage("products.view");
  const sp = await searchParams;
  const sql = getSql();
  const page = Number(sp.page) || 1;
  const filter = sp.filter === "missing" || sp.filter === "multiple" ? sp.filter : undefined;
  const categoryId = sp.category && /^[0-9a-f-]{36}$/.test(sp.category) ? sp.category : undefined;
  const [{ rows, total, totals }, cats] = await Promise.all([listForImageManager(sql, { q: sp.q, categoryId, filter, page }), listCategories(sql)]);
  const media = mediaStatus();
  const canEdit = session.permissions.has("products.edit");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const qs = (patch: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { ...sp, page: undefined, ...patch };
    return "?" + new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => !!e[1])).toString();
  };

  return (
    <>
      <PageHeader
        eyebrow="Catalog media"
        title="Product Image Manager"
        description={<>{totals.products} products · <b className={totals.missing ? "text-amber-800" : ""}>{totals.missing} without images</b>. Images uploaded here appear in the catalog, the product pages, the 3D store and the cart within seconds.</>}
        actions={<Link href="/admin/products" className="btn-ghost">← Products</Link>}
      />
      <div className="mb-4">
        <Notice tone={media.driver === "supabase" ? "ok" : media.driver === "local" ? "warn" : "bad"} title={media.driver === "supabase" ? "Supabase Storage connected" : media.driver === "local" ? "Development storage" : "Storage not configured"}>{media.detail}</Notice>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={qs({ filter: k || undefined })} className={`rounded-full px-3 py-1.5 text-sm ${(sp.filter ?? "") === k ? "bg-ink text-cream" : "text-ink-soft hover:bg-sand/60"}`}>{label}</Link>
        ))}
        <form className="ml-auto flex flex-wrap gap-2">
          {filter && <input type="hidden" name="filter" value={filter} />}
          <input name="q" defaultValue={sp.q} placeholder="Product, slug or SKU" className="admin-input !w-56 !py-1.5" aria-label="Search products" />
          <select name="category" defaultValue={sp.category ?? ""} className="admin-input !w-auto !py-1.5" aria-label="Category">
            <option value="">All categories</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn-ghost !py-1.5">Filter</button>
        </form>
      </div>
      {rows.length === 0 ? <EmptyState title="No products match" /> : (
        <ImageManagerGrid
          canEdit={canEdit && media.driver !== "none"}
          rows={rows.map((r) => ({
            id: r.id, name: r.name, slug: r.slug, status: r.status, categoryName: r.category_name, imageCount: r.image_count, skus: r.skus,
            primaryId: r.primary_id, primaryUrl: r.primary_path ? publicStorageUrl(supabaseUrl, r.primary_bucket ?? "product-images", r.primary_path) : null,
          }))}
        />
      )}
      <Pagination page={page} total={total} pageSize={48} params={sp} />
      {canEdit && media.driver !== "none" && (
        <div className="mt-6 rounded-2xl border border-line bg-white p-5 text-sm">
          <p className="font-semibold">Storage cleanup</p>
          <p className="mt-1 text-ink-soft">Replacing and deleting already removes old files when no product uses them. This also removes any leftover file (e.g. from an interrupted upload) that no product references and that is older than one hour.</p>
          <ActionForm action={cleanupStorageAction} submitLabel="Clean up unused files" variant="ghost" className="mt-3" confirm="Delete storage files that no product references?" />
        </div>
      )}
    </>
  );
}

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Badge, Card, Notice, PageHeader } from "@/features/admin/ui";
import { buildStoreLayout } from "@/features/store3d/layout";
import { STORE_CONFIG, SUPERMARKET } from "@/features/store3d/env/supermarket";
import { requirePage } from "@/lib/admin/guard";
import { loadCatalogSql } from "@/lib/catalog/sql-source";
import { getSql } from "@/lib/db/client";
import { getStorefrontSettings } from "@/lib/storefront/settings";

export const metadata = { title: "Store (3D shelves)" };

/** Live preview of the shelf plan the 3D store builds from the published catalog + admin placements. */
export default async function StoreAdminPage() {
  await requirePage("store.manage");
  const [{ categories, products }, settings] = await Promise.all([loadCatalogSql(getSql(), ""), getStorefrontSettings()]);
  const stockAll = settings.stockAllFaces ?? STORE_CONFIG.stockAllFaces;
  const layout = buildStoreLayout(categories, products, SUPERMARKET, stockAll ? "all" : STORE_CONFIG.benchmarkFaces);
  const byId = new Map(products.map((p) => [p.id, p]));
  const hidden = products.filter((p) => p.shelf?.hiddenInStore);
  return (
    <>
      <PageHeader
        title="3D store shelves"
        description="A map of the 3D store: which product is on which shelf. To move or hide a product, open it and use the “3D shelf” section."
        actions={<><Link className="btn-ghost" href="/admin/settings">Stock all aisles: {stockAll ? "on" : "off"}</Link><Link className="btn-primary" href="/store" target="_blank">Open 3D store<ArrowUpRight aria-hidden className="ml-1 inline h-4 w-4 align-[-3px]" /></Link></>}
      />
      <div className="mb-4"><Notice>{stockAll ? "Every gondola face is stocked." : `Only the benchmark aisle (${STORE_CONFIG.benchmarkFaces.join(", ")}) is stocked automatically; faces with pinned products are stocked too. Turn on “stock all aisles” in Settings once the benchmark aisle is approved.`} Storefront pages refresh within a minute of a change.</Notice></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {SUPERMARKET.faces.map((f) => {
          const tags = layout.priceTags.filter((t) => t.faceId === f.id);
          const ids = [...new Set(tags.map((t) => t.productId))];
          const stocked = layout.stockedFaces.includes(f.id);
          return (
            <Card key={f.id} title={<span className="flex items-center gap-2"><span className="font-mono">{f.id}</span>{stocked ? <Badge tone="green">stocked</Badge> : <Badge>empty</Badge>}{(STORE_CONFIG.benchmarkFaces as readonly string[]).includes(f.id) && <Badge tone="blue">benchmark</Badge>}</span>}>
              <p className="text-xs text-ink-soft">{f.boards.length} shelves × {f.bays.length} bays · {ids.length} product(s)</p>
              {ids.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {ids.map((id) => {
                    const p = byId.get(id)!;
                    return <li key={id} className="flex items-center gap-2"><Link className="truncate hover:underline" href={`/admin/products/${id}`}>{p.name}</Link>{p.shelf?.faceId === f.id && <Badge tone="amber">pinned</Badge>}{p.variants.every((v) => v.stockQuantity <= 0) && <Badge tone="red">sold out</Badge>}</li>;
                  })}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
      {(layout.unplaced.length > 0 || hidden.length > 0) && (
        <Card title="Not on a shelf" className="mt-6">
          {layout.unplaced.length > 0 && <p className="text-sm">No shelf space: {layout.unplaced.map((id) => <Link key={id} className="mr-2 text-brand underline" href={`/admin/products/${id}`}>{byId.get(id)?.name}</Link>)}</p>}
          {hidden.length > 0 && <p className="mt-2 text-sm">Hidden by admin: {hidden.map((p) => <Link key={p.id} className="mr-2 text-brand underline" href={`/admin/products/${p.id}`}>{p.name}</Link>)}</p>}
          <p className="mt-2 text-xs text-ink-soft">These products are still sold in the catalog.</p>
        </Card>
      )}
    </>
  );
}

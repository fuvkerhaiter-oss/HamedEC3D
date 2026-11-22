"use server";
import { revalidatePath } from "next/cache";
import { CATALOG_TAG, expirePublicData } from "@/lib/cache/public-data";
import { redirect } from "next/navigation";
import { z } from "zod";
import { adminAction, UserError } from "@/lib/admin/guard";
import { bool, currency, ids, int, optInt, optMoney, optMoneyAny, optStr, optUuid, reqStr, str, uuid } from "@/lib/admin/form";
import { ForbiddenError } from "@/lib/admin/permissions";
import {
  bulkSetCategory, deleteProducts, importProductsCsv, ProductError, removeVariant, restoreProduct,
  saveProduct, savePlacement, saveVariant, setProductStatus,
} from "@/lib/admin/services/products";

/** Storefront pages that read the catalog (ISR) are refreshed after every catalog change. */
function refreshStorefront(productId?: string) {
  expirePublicData(CATALOG_TAG);
  revalidatePath("/catalog/[slug]", "page");
  revalidatePath("/catalog");
  revalidatePath("/store");
  revalidatePath("/");
  revalidatePath("/admin/products");
  if (productId) revalidatePath(`/admin/products/${productId}`);
}

const wrap = async <T,>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ProductError) throw new UserError(e.message);
    throw e;
  }
};

export const saveProductAction = adminAction(
  "products.edit",
  z.object({
    id: optUuid, name: reqStr(200), slug: str(80), description: str(10000), categoryId: optUuid, brand: optStr(120),
    tags: str(500), seoTitle: optStr(200), seoDescription: optStr(400), isFeatured: bool,
  }),
  async (i, { sql, actor }) => {
    const id = await wrap(() => saveProduct(sql, actor, { ...i, id: i.id ?? undefined, tags: i.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 30) }));
    refreshStorefront(id);
    if (!i.id) redirect(`/admin/products/${id}`);
    return { ok: true, message: "Product saved." };
  },
);

export const saveVariantAction = adminAction(
  "products.edit",
  z.object({
    productId: uuid, id: optUuid, sku: reqStr(64).regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, . _ -"), name: reqStr(120), attributes: str(500),
    isActive: bool, sortOrder: int(0, 10000), weightGrams: optInt(0, 1_000_000), barcode: optStr(64),
    priceEur: optMoney("EUR"), compareEur: optMoney("EUR"), priceUsd: optMoney("USD"), compareUsd: optMoney("USD"),
    lowStockThreshold: optInt(0, 100000), initialStock: optInt(0, 1_000_000),
    supplierId: optUuid, supplierSku: optStr(120), costAmount: optMoneyAny, costCurrency: currency.optional(),
  }),
  async (i, { sql, actor, session }) => {
    const attributes = Object.fromEntries(
      i.attributes.split(/[;\n]/).map((p) => p.split("=").map((s) => s.trim())).filter((kv): kv is [string, string] => kv.length === 2 && !!kv[0] && !!kv[1]).slice(0, 20),
    );
    let supplier = null;
    if (i.supplierId) {
      if (!session.permissions.has("products.costs")) throw new ForbiddenError("products.costs");
      if (!i.supplierSku || i.costAmount === null || !i.costCurrency) throw new UserError("Supplier SKU, cost and cost currency are required for a supplier mapping");
      supplier = { supplierId: i.supplierId, supplierSku: i.supplierSku, costAmount: i.costAmount, costCurrency: i.costCurrency };
    }
    await wrap(() => saveVariant(sql, actor, { ...i, id: i.id ?? undefined, attributes, initialStock: i.id ? undefined : i.initialStock ?? 0, supplier }));
    refreshStorefront(i.productId);
    return { ok: true, message: i.id ? "Variant saved." : "Variant added." };
  },
);

export const removeVariantAction = adminAction("products.edit", z.object({ productId: uuid, variantId: uuid }), async (i, { sql, actor }) => {
  const r = await wrap(() => removeVariant(sql, actor, i.productId, i.variantId));
  refreshStorefront(i.productId);
  return { ok: true, message: r === "deleted" ? "Variant deleted." : "Variant has orders, so it was deactivated instead." };
});

export const setStatusAction = adminAction("products.publish", z.object({ ids, status: z.enum(["draft", "published", "archived"]) }), async (i, { sql, actor }) => {
  if (!i.ids.length) throw new UserError("Select at least one product");
  const r = await wrap(() => setProductStatus(sql, actor, i.ids, i.status));
  refreshStorefront(i.ids.length === 1 ? i.ids[0] : undefined);
  if (r.skipped.length) return { ok: false, error: `${r.changed} updated; not published: ${r.skipped.map((s) => s.split(": ").slice(1).join(": ")).join("; ")}` };
  return { ok: true, message: `${r.changed} product(s) set to ${i.status}.` };
});

export const deleteProductsAction = adminAction("products.delete", z.object({ ids, redirectTo: str(100).optional() }), async (i, { sql, actor }) => {
  if (!i.ids.length) throw new UserError("Select at least one product");
  const r = await wrap(() => deleteProducts(sql, actor, i.ids));
  refreshStorefront();
  if (i.redirectTo === "list") redirect("/admin/products");
  return { ok: true, message: `${r.hard} deleted, ${r.soft} moved to “Deleted” (kept for order history).` };
});

export const restoreProductAction = adminAction("products.delete", z.object({ id: uuid }), async (i, { sql, actor }) => {
  await restoreProduct(sql, actor, i.id);
  refreshStorefront(i.id);
  return { ok: true, message: "Restored as draft." };
});

export const bulkCategoryAction = adminAction("products.edit", z.object({ ids, categoryId: optUuid }), async (i, { sql, actor }) => {
  if (!i.ids.length) throw new UserError("Select at least one product");
  await bulkSetCategory(sql, actor, i.ids, i.categoryId);
  refreshStorefront();
  return { ok: true, message: `Moved ${i.ids.length} product(s).` };
});

export const placementAction = adminAction(
  "store.manage",
  z.object({ productId: uuid, faceId: optStr(8), priority: int(-1000, 1000), hiddenInStore: bool }),
  async (i, { sql, actor }) => {
    await savePlacement(sql, actor, i.productId, { faceId: i.faceId, priority: i.priority, hiddenInStore: i.hiddenInStore });
    refreshStorefront(i.productId);
    revalidatePath("/admin/store");
    return { ok: true, message: "3D shelf placement saved." };
  },
);

export const importCsvAction = adminAction(
  "products.import",
  z.object({ file: z.instanceof(File), dryRun: bool }),
  async (i, { sql, actor }) => {
    if (i.file.size === 0) throw new UserError("Choose a CSV file");
    if (i.file.size > 5 * 1024 * 1024) throw new UserError("File is larger than 5 MB");
    const report = await importProductsCsv(sql, actor, await i.file.text(), i.dryRun);
    if (report.errors.length) {
      return { ok: false, error: `Nothing was imported. ${report.errors.slice(0, 8).map((e) => (e.row ? `Row ${e.row}: ${e.message}` : e.message)).join(" · ")}${report.errors.length > 8 ? ` (+${report.errors.length - 8} more)` : ""}` };
    }
    if (!i.dryRun) refreshStorefront();
    return { ok: true, message: `${i.dryRun ? "Dry run OK — would create" : "Imported:"} ${report.created} new, ${report.updated} updated row(s).` };
  },
);

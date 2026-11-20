import { getSql } from "@/lib/db/client";
import { matchProductsForFiles } from "@/lib/admin/services/images";
import { handleImageUpload } from "@/lib/admin/upload";

export const dynamic = "force-dynamic";

/**
 * Bulk upload: one file per request; the product is chosen by `productId` (confirmed in the UI preview)
 * or matched from the original file name (product slug or variant SKU, optional "-2" gallery suffix).
 */
export async function POST(req: Request) {
  return handleImageUpload(req, async (fd, file) => {
    const sql = getSql();
    let productId = String(fd.get("productId") ?? "");
    if (!/^[0-9a-f-]{36}$/.test(productId)) {
      const [m] = await matchProductsForFiles(sql, [String(fd.get("fileName") ?? file.name)]);
      if (!m?.productId) return { error: `No product matches “${file.name}” (use the product slug or a SKU as the file name)` };
      productId = m.productId;
    }
    const [p] = await sql<{ slug: string }[]>`select slug from public.products where id = ${productId} and deleted_at is null`;
    return p ? { productId, slug: p.slug } : { error: "Product not found" };
  });
}

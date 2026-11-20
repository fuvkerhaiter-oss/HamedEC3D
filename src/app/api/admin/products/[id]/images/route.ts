import { getSql } from "@/lib/db/client";
import { handleImageUpload } from "@/lib/admin/upload";

export const dynamic = "force-dynamic";

/** Upload (or replace) one image of a product. multipart/form-data: file, alt?, primary?, replaceId? */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleImageUpload(req, async () => {
    if (!/^[0-9a-f-]{36}$/.test(id)) return { error: "Unknown product" };
    const [p] = await getSql()<{ slug: string }[]>`select slug from public.products where id = ${id} and deleted_at is null`;
    return p ? { productId: id, slug: p.slug } : { error: "Product not found" };
  });
}

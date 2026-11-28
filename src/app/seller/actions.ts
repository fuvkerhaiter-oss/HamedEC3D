"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { bool } from "@/lib/admin/form";
import { getMediaStorage } from "@/lib/media/storage";
import { DoorStyleInput } from "@/lib/rentals/door-style";
import { ownHosts, sellerAction } from "@/lib/tenants/access";
import { ProductInput, ProfileInput } from "@/lib/tenants/schema";
import {
  createProduct,
  deleteAdSlide,
  deleteProduct,
  moveAdSlide,
  moveProduct,
  removeImageIfUnused,
  setDoorStyle,
  setLogo,
  setProductStatus,
  setStorefrontOpen,
  updateProduct,
  updateProfile,
} from "@/lib/tenants/service";

const uuid = z.string().regex(/^[0-9a-f-]{36}$/, "Invalid id");

/** The 3D store (ISR), the seller area and the super admin's tenant pages. */
function refresh() {
  revalidatePath("/store");
  revalidatePath("/seller", "layout");
  revalidatePath("/admin/rentals/tenants", "layout");
}

export const saveProfileAction = sellerAction(
  async () => ProfileInput(await ownHosts()),
  async (input, { sql, tenant }) => {
    const { signPending } = await updateProfile(sql, tenant, input);
    refresh();
    return { ok: true, message: signPending ? "Saved. Your new sign name goes live once our team approves it (usually within a day)." : "Saved. Your shop is updated." };
  },
);

export const saveDoorAction = sellerAction(DoorStyleInput, async (style, { sql, tenant }) => {
  await setDoorStyle(sql, tenant.id, style);
  refresh();
  return { ok: true, message: "Saved. Your shop door in the 3D store is updated." };
});

export const setOpenAction =sellerAction(z.object({ open: bool }), async ({ open }, { sql, tenant }) => {
  await setStorefrontOpen(sql, tenant.id, open);
  refresh();
  return { ok: true, message: open ? "Your shop is open: shoppers can walk in and see your products." : "Your shop is closed to shoppers." };
});

export const removeLogoAction = sellerAction(z.object({}), async (_i, { sql, tenant }) => {
  const old = await setLogo(sql, tenant.id, null, null);
  const storage = getMediaStorage();
  if (old && storage) await removeImageIfUnused(sql, storage, old.bucket, old.path);
  refresh();
  return { ok: true, message: "Logo removed." };
});

export const saveProductAction = sellerAction(
  async () => ProductInput(await ownHosts()).extend({ id: z.preprocess((v) => (v === "" ? undefined : v), uuid.optional()) }),
  async ({ id, ...p }, { sql, tenant }) => {
    const row = id ? await updateProduct(sql, tenant.id, id, p) : await createProduct(sql, tenant.id, p);
    refresh();
    if (!id) redirect(`/seller/products/${row.id}?created=1`);
    return { ok: true, message: p.publish ? "Saved and on your shelves." : "Saved as a draft (not shown in the store)." };
  },
);

export const productStatusAction = sellerAction(z.object({ id: uuid, publish: bool }), async ({ id, publish }, { sql, tenant }) => {
  await setProductStatus(sql, tenant.id, id, publish);
  refresh();
  return { ok: true, message: publish ? "Published." : "Moved to drafts." };
});

export const moveProductAction = sellerAction(z.object({ id: uuid, dir: z.enum(["up", "down"]) }), async ({ id, dir }, { sql, tenant }) => {
  await moveProduct(sql, tenant.id, id, dir === "up" ? -1 : 1);
  refresh();
  return { ok: true };
});

export const deleteProductAction = sellerAction(z.object({ id: uuid }), async ({ id }, { sql, tenant }) => {
  const img = await deleteProduct(sql, tenant.id, id);
  const storage = getMediaStorage();
  if (img && storage) await removeImageIfUnused(sql, storage, img.bucket, img.path);
  refresh();
  redirect("/seller/products?deleted=1");
});

export const moveAdSlideAction = sellerAction(z.object({ id: uuid, dir: z.enum(["up", "down"]) }), async ({ id, dir }, { sql, tenant }) => {
  await moveAdSlide(sql, tenant.id, id, dir === "up" ? -1 : 1);
  refresh();
  return { ok: true };
});

export const deleteAdSlideAction = sellerAction(z.object({ id: uuid }), async ({ id }, { sql, tenant }) => {
  const img = await deleteAdSlide(sql, tenant.id, id);
  const storage = getMediaStorage();
  if (img && storage) await removeImageIfUnused(sql, storage, img.bucket, img.path);
  refresh();
  return { ok: true, message: "Ad slide removed." };
});

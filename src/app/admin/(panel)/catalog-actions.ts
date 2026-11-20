"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction, UserError } from "@/lib/admin/guard";
import { bool, int, optUuid, reqStr, str, uuid } from "@/lib/admin/form";
import { adjustStock, deleteCategory, moveCategory, saveCategory, setIncoming, setSupplierReported } from "@/lib/admin/services/catalog-admin";

const refresh = () => {
  revalidatePath("/catalog");
  revalidatePath("/store");
  revalidatePath("/");
};

const userErr = async <T,>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && !("code" in e)) throw new UserError(e.message);
    throw e;
  }
};

export const saveCategoryAction = adminAction(
  "categories.manage",
  z.object({ id: optUuid, name: reqStr(120), slug: str(80), description: str(2000), parentId: optUuid, isActive: bool }),
  async (i, { sql, actor }) => {
    await userErr(() => saveCategory(sql, actor, { ...i, id: i.id ?? undefined }));
    refresh();
    revalidatePath("/admin/categories");
    return { ok: true, message: "Category saved." };
  },
);

export const deleteCategoryAction = adminAction("categories.manage", z.object({ id: uuid }), async (i, { sql, actor }) => {
  await userErr(() => deleteCategory(sql, actor, i.id));
  refresh();
  revalidatePath("/admin/categories");
  return { ok: true, message: "Category deleted." };
});

export const moveCategoryAction = adminAction("categories.manage", z.object({ id: uuid, dir: z.enum(["up", "down"]) }), async (i, { sql, actor }) => {
  await moveCategory(sql, actor, i.id, i.dir === "up" ? -1 : 1);
  refresh();
  revalidatePath("/admin/categories");
  return { ok: true };
});

export const adjustStockAction = adminAction(
  "inventory.adjust",
  z.object({ variantId: uuid, quantity: int(0, 10_000_000), reason: reqStr(300) }),
  async (i, { sql, actor }) => {
    const r = await adjustStock(sql, actor, i.variantId, i.quantity, i.reason);
    refresh();
    revalidatePath("/admin/inventory");
    return { ok: true, message: `Stock set to ${r.quantity} (${r.quantity - r.reserved} available).` };
  },
);

export const incomingAction = adminAction(
  "inventory.adjust",
  z.object({ variantId: uuid, incoming: int(0, 10_000_000), supplierReported: z.string().optional(), reason: str(300) }),
  async (i, { sql, actor }) => {
    await userErr(() => setIncoming(sql, actor, i.variantId, i.incoming, i.reason || "Updated"));
    if (i.supplierReported && i.supplierReported.trim() !== "") {
      const n = Number(i.supplierReported);
      if (!Number.isInteger(n) || n < 0) throw new UserError("Supplier-reported stock must be a whole number");
      await setSupplierReported(sql, actor, i.variantId, n);
    }
    revalidatePath("/admin/inventory");
    return { ok: true, message: "Saved." };
  },
);

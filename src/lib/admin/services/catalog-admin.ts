/** Categories (dynamic, ordered, nested) and inventory management. */
import { inTx, type Db } from "../../db/client";
import { logActivity, type Actor } from "../audit";
import { clearDedupe, notify } from "./notifications";
import { lowStockDefault } from "./settings";
import { slugify } from "./products";

// ───────────────────────── Categories ─────────────────────────

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  product_count: number;
  child_count: number;
}

export async function listCategories(db: Db): Promise<CategoryRow[]> {
  return db<CategoryRow[]>`
    select c.id, c.slug, c.name, c.description, c.parent_id, c.sort_order, c.is_active,
      (select count(*)::int from public.products p where p.category_id = c.id and p.deleted_at is null) as product_count,
      (select count(*)::int from public.categories k where k.parent_id = c.id) as child_count
    from public.categories c order by c.sort_order, c.name`;
}

/** Depth-first ordered list with depth (parents before children). */
export function categoryTree(rows: CategoryRow[]): (CategoryRow & { depth: number })[] {
  const out: (CategoryRow & { depth: number })[] = [];
  const walk = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const c of rows.filter((r) => r.parent_id === parent)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ ...c, depth });
      walk(c.id, depth + 1, seen);
    }
  };
  const seen = new Set<string>();
  walk(null, 0, seen);
  for (const c of rows) if (!seen.has(c.id)) out.push({ ...c, depth: 0 }); // orphans (parent removed)
  return out;
}

export async function saveCategory(db: Db, actor: Actor, c: { id?: string; name: string; slug?: string; description: string; parentId: string | null; isActive: boolean }) {
  const slug = slugify(c.slug || c.name);
  if (!slug) throw new Error("Name must contain letters or digits");
  return inTx(db, async (tx) => {
    if (c.id && c.parentId) {
      // Prevent cycles: the new parent must not be a descendant.
      const [cyc] = await tx<{ hit: boolean }[]>`
        with recursive d as (select id from public.categories where id = ${c.id}
          union all select k.id from public.categories k join d on k.parent_id = d.id)
        select exists (select 1 from d where id = ${c.parentId}) as hit`;
      if (cyc?.hit) throw new Error("A category can't be moved under itself or its subcategories");
    }
    const vals = { name: c.name.trim(), slug, description: c.description, parent_id: c.parentId, is_active: c.isActive };
    if (c.id) {
      const [before] = await tx`select name, slug, description, parent_id, is_active from public.categories where id = ${c.id}`;
      await tx`update public.categories set ${tx(vals)} where id = ${c.id}`;
      await tx`update public.store_sections set name = ${vals.name} where category_id = ${c.id}`;
      await logActivity(tx, actor, { action: "category.update", entity: "category", entityId: c.id, summary: `Updated ${vals.name}`, before, after: vals });
      return c.id;
    }
    const [{ next }] = (await tx<{ next: number }[]>`select coalesce(max(sort_order), 0)::int + 1 as next from public.categories`) as unknown as [{ next: number }];
    const [row] = await tx<{ id: string }[]>`insert into public.categories ${tx({ ...vals, sort_order: next })} returning id`;
    await logActivity(tx, actor, { action: "category.create", entity: "category", entityId: row!.id, summary: `Created ${vals.name}`, after: vals });
    return row!.id;
  });
}

export async function deleteCategory(db: Db, actor: Actor, id: string) {
  const [c] = await db<{ name: string; products: number; children: number }[]>`
    select name, (select count(*)::int from public.products p where p.category_id = c.id) as products,
      (select count(*)::int from public.categories k where k.parent_id = c.id) as children from public.categories c where id = ${id}`;
  if (!c) throw new Error("Category not found");
  if (c.products > 0) throw new Error(`Move the ${c.products} product(s) in “${c.name}” first (or deactivate the category)`);
  if (c.children > 0) throw new Error("Delete or move its subcategories first");
  await db`delete from public.categories where id = ${id}`;
  await logActivity(db, actor, { action: "category.delete", entity: "category", entityId: id, summary: `Deleted ${c.name}` });
}

export async function moveCategory(db: Db, actor: Actor, id: string, dir: -1 | 1) {
  await inTx(db, async (tx) => {
    const [me] = await tx<{ parent_id: string | null }[]>`select parent_id from public.categories where id = ${id}`;
    if (!me) return;
    const sibs = await tx<{ id: string }[]>`select id from public.categories where parent_id is not distinct from ${me.parent_id} order by sort_order, name for update`;
    const order = sibs.map((s) => s.id);
    const i = order.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    for (let k = 0; k < order.length; k++) await tx`update public.categories set sort_order = ${k + 1} where id = ${order[k]!}`;
    await logActivity(tx, actor, { action: "category.reorder", entity: "category", entityId: id, summary: "Reordered categories" });
  });
}

// ───────────────────────── Inventory ─────────────────────────

export interface InventoryRow {
  variant_id: string;
  product_id: string;
  product_name: string;
  product_status: string;
  sku: string;
  variant_name: string;
  quantity: number;
  reserved: number;
  available: number;
  incoming: number;
  supplier_reported: number | null;
  supplier_reported_at: Date | null;
  threshold: number;
  updated_at: Date | null;
}

export async function listInventory(db: Db, f: { q?: string; filter?: "low" | "out" | "reserved"; page?: number; pageSize?: number }) {
  const def = await lowStockDefault(db);
  const q = f.q?.trim() ?? "";
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(1, f.page ?? 1);
  const where = db`
    where p.deleted_at is null and v.is_active
      and (${q} = '' or p.name ilike ${"%" + q + "%"} or v.sku ilike ${"%" + q + "%"})
      and (${f.filter ?? null}::text is null
        or (${f.filter ?? null} = 'out' and coalesce(i.quantity, 0) - coalesce(i.reserved, 0) <= 0)
        or (${f.filter ?? null} = 'low' and coalesce(i.quantity, 0) - coalesce(i.reserved, 0) <= coalesce(i.low_stock_threshold, ${def}))
        or (${f.filter ?? null} = 'reserved' and coalesce(i.reserved, 0) > 0))`;
  const [count] = await db<{ n: number }[]>`
    select count(*)::int as n from public.product_variants v join public.products p on p.id = v.product_id left join public.inventory i on i.variant_id = v.id ${where}`;
  const rows = await db<InventoryRow[]>`
    select v.id as variant_id, p.id as product_id, p.name as product_name, p.status::text as product_status, v.sku, v.name as variant_name,
      coalesce(i.quantity, 0) as quantity, coalesce(i.reserved, 0) as reserved, coalesce(i.quantity, 0) - coalesce(i.reserved, 0) as available,
      coalesce(i.incoming, 0) as incoming, i.supplier_reported, i.supplier_reported_at, coalesce(i.low_stock_threshold, ${def})::int as threshold, i.updated_at
    from public.product_variants v join public.products p on p.id = v.product_id left join public.inventory i on i.variant_id = v.id
    ${where}
    order by (coalesce(i.quantity, 0) - coalesce(i.reserved, 0)) asc, p.name limit ${pageSize} offset ${(page - 1) * pageSize}`;
  return { rows, total: count?.n ?? 0 };
}

/** Sets on-hand stock (locked, logged with before/after/reason/admin), and raises/clears low-stock alerts. */
export async function adjustStock(db: Db, actor: Actor, variantId: string, newQuantity: number, reason: string) {
  return inTx(db, async (tx) => {
    const [after] = await tx<{ quantity: number; reserved: number; low_stock_threshold: number | null }[]>`
      select * from public.admin_adjust_inventory(${variantId}, ${newQuantity}, ${reason}, ${actor.id}, 'adjustment')`;
    const [v] = await tx<{ sku: string; name: string; product_id: string }[]>`
      select v.sku, p.name, p.id as product_id from public.product_variants v join public.products p on p.id = v.product_id where v.id = ${variantId}`;
    await logActivity(tx, actor, { action: "inventory.adjust", entity: "variant", entityId: variantId, summary: `${v?.sku}: stock set to ${newQuantity} (${reason})` });
    await checkLowStock(tx, variantId, after!.quantity - after!.reserved, after!.low_stock_threshold, v ? `${v.name} (${v.sku})` : variantId, v?.product_id);
    return after!;
  });
}

export async function checkLowStock(db: Db, variantId: string, available: number, threshold: number | null, label: string, productId?: string) {
  const t = threshold ?? (await lowStockDefault(db));
  const key = `low_stock:${variantId}`;
  if (available <= t) {
    await notify(db, {
      kind: "low_stock", severity: available <= 0 ? "critical" : "warning",
      title: available <= 0 ? `Out of stock: ${label}` : `Low stock: ${label} (${available} left)`,
      link: productId ? `/admin/products/${productId}` : "/admin/inventory?filter=low", dedupeKey: key,
    });
  } else {
    await clearDedupe(db, key);
  }
}

export async function setIncoming(db: Db, actor: Actor, variantId: string, incoming: number, reason: string) {
  await inTx(db, async (tx) => {
    const [old] = await tx<{ quantity: number; reserved: number; incoming: number }[]>`select quantity, reserved, incoming from public.inventory where variant_id = ${variantId} for update`;
    if (!old) throw new Error("No inventory record for this variant");
    await tx`update public.inventory set incoming = ${incoming}, updated_at = now() where variant_id = ${variantId}`;
    await tx`insert into public.inventory_movements (variant_id, kind, quantity_before, quantity_after, reserved_before, reserved_after, reason, admin_user_id)
             values (${variantId}, 'incoming', ${old.quantity}, ${old.quantity}, ${old.reserved}, ${old.reserved}, ${`Incoming ${old.incoming} → ${incoming}: ${reason}`}, ${actor.id})`;
    await logActivity(tx, actor, { action: "inventory.incoming", entity: "variant", entityId: variantId, summary: `Incoming set to ${incoming}` });
  });
}

/** Records the stock a supplier reports (manually entered or from an adapter). Does not change sellable stock. */
export async function setSupplierReported(db: Db, actor: Actor | null, variantId: string, reported: number) {
  await db`update public.inventory set supplier_reported = ${reported}, supplier_reported_at = now() where variant_id = ${variantId}`;
  await logActivity(db, actor, { action: "inventory.supplier_reported", entity: "variant", entityId: variantId, summary: `Supplier-reported stock: ${reported}` });
}

export async function listMovements(db: Db, f: { variantId?: string; page?: number; pageSize?: number }) {
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(1, f.page ?? 1);
  return db<{
    id: number; kind: string; quantity_before: number; quantity_after: number; reserved_before: number; reserved_after: number;
    reason: string; order_id: string | null; order_number: number | null; admin_email: string | null; created_at: Date; sku: string; product_name: string;
  }[]>`
    select m.*, o.order_number, u.email as admin_email, v.sku, p.name as product_name
      from public.inventory_movements m
      join public.product_variants v on v.id = m.variant_id join public.products p on p.id = v.product_id
      left join public.orders o on o.id = m.order_id left join public.admin_users u on u.id = m.admin_user_id
     where (${f.variantId ?? null}::uuid is null or m.variant_id = ${f.variantId ?? null})
     order by m.created_at desc, m.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`;
}

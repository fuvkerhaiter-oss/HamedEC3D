import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, EmptyState, Field, PageHeader } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { categoryTree, listCategories, type CategoryRow } from "@/lib/admin/services/catalog-admin";
import { getSql } from "@/lib/db/client";
import { deleteCategoryAction, moveCategoryAction, saveCategoryAction } from "../catalog-actions";

export const metadata = { title: "Categories" };

function CategoryForm({ c, all }: { c?: CategoryRow; all: CategoryRow[] }) {
  return (
    <ActionForm action={saveCategoryAction} submitLabel={c ? "Save" : "Add category"} resetOnSuccess={!c}>
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><input name="name" defaultValue={c?.name} required className="admin-input" /></Field>
        <Field label="Slug" hint="Used in /catalog?category="><input name="slug" defaultValue={c?.slug} className="admin-input font-mono" /></Field>
        <Field label="Parent">
          <select name="parentId" defaultValue={c?.parent_id ?? ""} className="admin-input">
            <option value="">— top level —</option>
            {all.filter((x) => x.id !== c?.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description"><textarea name="description" defaultValue={c?.description} rows={2} className="admin-input" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={c?.is_active ?? true} className="h-4 w-4" /> Active (shown in the store)</label>
    </ActionForm>
  );
}

export default async function CategoriesPage() {
  await requirePage("categories.manage");
  const rows = await listCategories(getSql());
  const tree = categoryTree(rows);
  return (
    <>
      <PageHeader title="Categories" description="Groups of products (for example Food, Toys). They appear as filters in the shop and as aisle signs in the 3D store. The order here is the order in the shop." />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={`All categories (${rows.length})`} className="xl:col-span-2" pad={false}>
          {tree.length === 0 ? <div className="p-5"><EmptyState title="No categories yet" /></div> : (
            <ul className="divide-y divide-line">
              {tree.map((c) => (
                <li key={c.id}>
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-5 py-3 text-sm" style={{ paddingLeft: `${1.25 + c.depth * 1.5}rem` }}>
                      {c.depth > 0 && <span aria-hidden className="text-ink-soft">↳</span>}
                      <span className="font-medium">{c.name}</span>
                      <span className="font-mono text-xs text-ink-soft">{c.slug}</span>
                      {!c.is_active && <Badge>inactive</Badge>}
                      <span className="ml-auto flex items-center gap-2">
                        <span className="font-mono text-xs text-ink-soft">{c.product_count} products</span>
                        {(["up", "down"] as const).map((d) => (
                          <ActionForm key={d} action={moveCategoryAction} inline hideMessage>
                            <input type="hidden" name="id" value={c.id} /><input type="hidden" name="dir" value={d} />
                            <button className="btn-ghost !px-2 !py-0.5 text-xs" aria-label={`Move ${c.name} ${d}`}>{d === "up" ? "↑" : "↓"}</button>
                          </ActionForm>
                        ))}
                      </span>
                    </summary>
                    <div className="space-y-3 border-t border-line bg-cream/50 p-5">
                      <CategoryForm c={c} all={rows} />
                      <ActionForm action={deleteCategoryAction} inline confirm={`Delete ${c.name}?`}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn-danger" disabled={c.product_count > 0 || c.child_count > 0}>Delete</button>
                        {(c.product_count > 0 || c.child_count > 0) && <span className="text-xs text-ink-soft">Move its products/subcategories first, or deactivate it.</span>}
                      </ActionForm>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="New category"><CategoryForm all={rows} /></Card>
      </div>
    </>
  );
}

"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction, UserError } from "@/lib/admin/guard";
import { bool, optStr, uuid } from "@/lib/admin/form";
import { logActivity } from "@/lib/admin/audit";
import { fromDecimalString } from "@/lib/money";
import { DoorStyleInput, doorStyleFrom } from "@/lib/rentals/door-style";
import { getTenant, setDoorStyle, setMonthlyFee, setProductHidden, setSuspended, setTenantNote } from "@/lib/tenants/service";

const refresh = (id?: string) => {
  revalidatePath("/admin/rentals/tenants");
  if (id) revalidatePath(`/admin/rentals/tenants/${id}`);
  revalidatePath("/store");
  revalidatePath("/seller", "layout");
};

async function tenantOr404(sql: Parameters<typeof getTenant>[0], id: string) {
  const t = await getTenant(sql, id);
  if (!t) throw new UserError("That tenant no longer exists.");
  return t;
}

export const tenantFeeAction = adminAction(
  "orders.manage",
  z.object({ id: uuid, fee: z.string().trim().max(20), currency: z.enum(["EUR", "USD"]) }),
  async ({ id, fee, currency }, { sql, actor }) => {
    const t = await tenantOr404(sql, id);
    let amount = 0;
    if (fee) {
      try {
        amount = fromDecimalString(fee.replace(",", "."), currency).amount;
      } catch {
        throw new UserError("Enter an amount like 10 or 9.50 (0 = no fee).");
      }
      if (amount < 0 || amount > 10_000_000) throw new UserError("Enter an amount between 0 and 100000.");
    }
    await setMonthlyFee(sql, id, amount);
    await logActivity(sql, actor, {
      action: "tenant.fee", entity: "tenant_account", entityId: id,
      summary: `Monthly fee for ${t.brand_name}: ${amount ? `${fee} ${currency}` : "none"}`, before: { fee: t.monthly_fee }, after: { fee: amount },
    });
    refresh(id);
    return { ok: true, message: amount ? "Saved. It's added to their next rent payment." : "Fee removed." };
  },
);

export const tenantSuspendAction = adminAction(
  "orders.manage",
  z.object({ id: uuid, suspended: bool, reason: optStr(300) }),
  async ({ id, suspended, reason }, { sql, actor }) => {
    const t = await tenantOr404(sql, id);
    if (suspended && !reason) throw new UserError("Tell the tenant why (they see this in their dashboard).");
    await setSuspended(sql, id, suspended, reason);
    await logActivity(sql, actor, {
      action: suspended ? "tenant.suspend" : "tenant.unsuspend", entity: "tenant_account", entityId: id,
      summary: `${suspended ? "Paused" : "Reopened"} the shop of ${t.brand_name}${reason ? `: ${reason}` : ""}`,
    });
    refresh(id);
    return { ok: true, message: suspended ? "Shop paused: hidden from shoppers." : "Shop reopened (if the tenant has it open)." };
  },
);

export const tenantDoorAction = adminAction("orders.manage", DoorStyleInput.extend({ id: uuid }), async ({ id, ...style }, { sql, actor }) => {
  const t = await tenantOr404(sql, id);
  await setDoorStyle(sql, id, style);
  await logActivity(sql, actor, {
    action: "tenant.door", entity: "tenant_account", entityId: id,
    summary: `Door of ${t.brand_name}: frame ${style.frame}, light ${style.light} (${style.effect}, ${style.level}%)`,
    before: doorStyleFrom(t), after: style,
  });
  refresh(id);
  return { ok: true, message: "Saved. The shop door in the 3D store is updated." };
});

export const tenantNoteAction =adminAction("orders.manage", z.object({ id: uuid, note: optStr(2000) }), async ({ id, note }, { sql, actor }) => {
  await tenantOr404(sql, id);
  await setTenantNote(sql, id, note);
  await logActivity(sql, actor, { action: "tenant.note", entity: "tenant_account", entityId: id, summary: "Updated the internal note" });
  refresh(id);
  return { ok: true, message: "Note saved." };
});

export const tenantProductHideAction = adminAction(
  "orders.manage",
  z.object({ id: uuid, tenantId: uuid, hidden: bool, reason: optStr(300) }),
  async ({ id, tenantId, hidden, reason }, { sql, actor }) => {
    if (hidden && !reason) throw new UserError("Tell the tenant why (they see this next to the product).");
    const p = await setProductHidden(sql, id, hidden, reason);
    if (!p || p.tenant_id !== tenantId) throw new UserError("That product no longer exists.");
    await logActivity(sql, actor, {
      action: hidden ? "tenant.product.hide" : "tenant.product.show", entity: "tenant_product", entityId: id,
      summary: `${hidden ? "Hid" : "Showed"} “${p.title}”${reason ? `: ${reason}` : ""}`,
    });
    refresh(tenantId);
    return { ok: true, message: hidden ? "Hidden from the store." : "Visible again (if published)." };
  },
);

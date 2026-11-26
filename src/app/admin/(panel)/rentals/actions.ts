"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction, UserError } from "@/lib/admin/guard";
import { bool, optStr, reqStr, str, uuid } from "@/lib/admin/form";
import { logActivity } from "@/lib/admin/audit";
import { fromDecimalString } from "@/lib/money";
import { isShopId } from "@/lib/rentals/availability";
import { cancelLease, getLease, moveLease, RentalError, resolveReview, setLeaseDisplay, setLeaseNote, shopLabel } from "@/lib/rentals/service";

const refresh = () => {
  revalidatePath("/admin/rentals");
  revalidatePath("/store");
  revalidatePath("/rent-a-shop");
};

async function friendly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RentalError) throw new UserError(e.message);
    throw e;
  }
}

export const leaseDisplayAction = adminAction(
  "orders.manage",
  z.object({ id: uuid, displayName: reqStr(40), approved: bool }),
  async ({ id, displayName, approved }, { sql, actor }) => {
    const l = await friendly(() => setLeaseDisplay(sql, id, displayName, approved));
    await logActivity(sql, actor, {
      action: "rental.display", entity: "shop_lease", entityId: id,
      summary: `${approved ? "Showed" : "Hid"} “${displayName}” on ${shopLabel(l.shop_id)} (${l.reference})`, after: { displayName, approved },
    });
    refresh();
    return { ok: true, message: approved ? "Shown on the 3D sign." : "Saved. The sign shows “Opening soon”." };
  },
);

export const leaseNoteAction = adminAction("orders.manage", z.object({ id: uuid, note: optStr(2000) }), async ({ id, note }, { sql, actor }) => {
  await setLeaseNote(sql, id, note);
  await logActivity(sql, actor, { action: "rental.note", entity: "shop_lease", entityId: id, summary: "Updated rental note" });
  revalidatePath("/admin/rentals");
  return { ok: true, message: "Note saved." };
});

export const leaseCancelAction = adminAction(
  "orders.refund",
  z.object({ id: uuid, refund: str(20), reason: reqStr(500) }),
  async ({ id, refund, reason }, { sql, actor }) => {
    const before = await getLease(sql, id);
    if (!before) throw new UserError("Rental not found");
    let minor = 0;
    if (refund.trim()) {
      try {
        minor = fromDecimalString(refund.trim(), before.currency).amount;
      } catch {
        throw new UserError("Refund amount: use a number like 20 or 12.50");
      }
    }
    const l = await friendly(() => cancelLease(sql, id, { refund: minor, reason }));
    await logActivity(sql, actor, {
      action: "rental.cancel", entity: "shop_lease", entityId: id,
      summary: `Cancelled rental ${l.reference} (${shopLabel(l.shop_id)})${minor ? `, refunded ${refund} ${l.currency}` : ""}: ${reason}`,
      before: { status: before.status, refunded: before.refunded_amount }, after: { status: l.status, refunded: l.refunded_amount },
    });
    refresh();
    return { ok: true, message: minor ? "Cancelled and refund sent." : "Cancelled. The shop is free again." };
  },
);

export const leaseActivateAction = adminAction("orders.manage", z.object({ id: uuid }), async ({ id }, { sql, actor }) => {
  const ok = await friendly(() => resolveReview(sql, id));
  if (!ok) throw new UserError("The shop is still rented by someone else. Move this booking to a free shop or refund it.");
  await logActivity(sql, actor, { action: "rental.activate", entity: "shop_lease", entityId: id, summary: "Activated a rental that was in payment review" });
  refresh();
  return { ok: true, message: "Activated. The tenant got their confirmation email." };
});

export const leaseMoveAction = adminAction(
  "orders.manage",
  z.object({ id: uuid, shopId: z.string().refine(isShopId, "Unknown shop") }),
  async ({ id, shopId }, { sql, actor }) => {
    await friendly(() => moveLease(sql, id, shopId));
    await logActivity(sql, actor, { action: "rental.move", entity: "shop_lease", entityId: id, summary: `Moved rental to ${shopLabel(shopId)}` });
    refresh();
    return { ok: true, message: `Moved to ${shopLabel(shopId)}.` };
  },
);

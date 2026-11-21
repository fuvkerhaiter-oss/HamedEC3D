"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getSql } from "@/lib/db/client";
import { flushEmailOutbox } from "@/lib/email/outbox";
import { z } from "zod";
import { adminAction, UserError } from "@/lib/admin/guard";
import { bool, currency, money as moneyField, optMoneyAny, optStr, reqStr, str, uuid } from "@/lib/admin/form";
import { ORDER_STATUSES } from "@/lib/orders/state-machine";
import { InvalidTransitionError } from "@/lib/orders/state-machine";
import { addOrderNote, addShipment, adminTransition, issueInvoice, OrderError, refundOrder, updateShipmentStatus } from "@/lib/admin/services/orders";
import { createSupplierOrders, recordSupplierSubmission } from "@/lib/admin/services/suppliers";

const done = (orderId: string) => {
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  after(() => flushEmailOutbox(getSql()).catch((e) => console.error("email flush failed", e))); // customer emails queued by the change
};

async function friendly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof OrderError || e instanceof InvalidTransitionError) throw new UserError(e.message);
    throw e;
  }
}

export const transitionAction = adminAction(
  "orders.manage",
  z.object({ orderId: uuid, to: z.enum(ORDER_STATUSES), reason: str(500) }),
  async (i, { sql, actor }) => {
    if (i.to === "cancelled" && !i.reason) throw new UserError("Give a reason for cancelling");
    const r = await friendly(() => adminTransition(sql, actor, i.orderId, i.to, i.reason));
    done(i.orderId);
    revalidatePath("/catalog");
    revalidatePath("/store");
    return { ok: true, message: `Order moved ${r.from} → ${r.to}.` };
  },
);

export const noteAction = adminAction("orders.manage", z.object({ orderId: uuid, body: reqStr(5000), customerVisible: bool }), async (i, { sql, actor }) => {
  await addOrderNote(sql, actor, i.orderId, i.body, i.customerVisible);
  done(i.orderId);
  return { ok: true, message: "Note added." };
});

export const shipmentAction = adminAction(
  "orders.manage",
  z.object({
    orderId: uuid, carrier: reqStr(80), trackingNumber: reqStr(80).regex(/^[A-Za-z0-9 -]+$/, "Letters, digits, spaces and dashes"),
    trackingUrl: optStr(500).refine((u) => u === null || /^https:\/\//.test(u), "Must be an https:// link"), notes: str(1000), markShipped: bool,
  }),
  async (i, { sql, actor }) => {
    await friendly(() => addShipment(sql, actor, i.orderId, i));
    done(i.orderId);
    return { ok: true, message: "Shipment recorded." };
  },
);

export const shipmentStatusAction = adminAction(
  "orders.manage",
  z.object({ orderId: uuid, shipmentId: uuid, status: z.enum(["in_transit", "out_for_delivery", "delivered", "exception"]) }),
  async (i, { sql, actor }) => {
    await friendly(() => updateShipmentStatus(sql, actor, i.shipmentId, i.status));
    done(i.orderId);
    return { ok: true, message: "Shipment updated." };
  },
);

export const supplierOrdersAction = adminAction("suppliers.manage", z.object({ orderId: uuid }), async (i, { sql, actor }) => {
  const r = await friendly(() => createSupplierOrders(sql, actor, i.orderId));
  done(i.orderId);
  if (r.results.length === 0) return { ok: false, error: `No item in this order is mapped to an active supplier (${r.unassigned} unmapped). Map the SKUs under Suppliers, or fulfil manually and record the shipment.` };
  return { ok: true, message: `${r.results.length} supplier order(s) ready${r.unassigned ? `; ${r.unassigned} item(s) have no supplier mapping` : ""}.` };
});

export const supplierRefAction = adminAction(
  "suppliers.manage",
  z.object({ orderId: uuid, supplierOrderId: uuid, ref: reqStr(120), cost: optMoneyAny, costCurrency: currency.optional() }),
  async (i, { sql, actor }) => {
    await friendly(() => recordSupplierSubmission(sql, actor, i.supplierOrderId, i.ref, i.cost !== null && i.costCurrency ? { amount: i.cost, currency: i.costCurrency } : null));
    done(i.orderId);
    return { ok: true, message: "Supplier reference recorded." };
  },
);

export const refundAction = adminAction(
  "orders.refund",
  z.object({ orderId: uuid, amount: moneyField("EUR"), reason: reqStr(1000), manual: bool, manualReference: optStr(120) }),
  async (i, { sql, actor }) => {
    if (i.manual && !i.manualReference) throw new UserError("Enter the refund reference from the payment provider");
    const r = await friendly(() => refundOrder(sql, actor, i.orderId, { amount: i.amount, reason: i.reason, manual: i.manual, manualReference: i.manualReference ?? undefined }));
    done(i.orderId);
    return { ok: true, message: r.status === "manual" ? "Manual refund recorded." : "Refund sent to the provider. The order is marked refunded when the provider confirms." };
  },
);

export const invoiceAction = adminAction("orders.manage", z.object({ orderId: uuid }), async (i, { sql, actor }) => {
  const n = await friendly(() => issueInvoice(sql, actor, i.orderId));
  done(i.orderId);
  return { ok: true, message: `Invoice ${n} issued.` };
});

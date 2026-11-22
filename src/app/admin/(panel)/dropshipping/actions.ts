"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction, UserError } from "@/lib/admin/guard";
import { bool, currency, int, optStr, reqStr, uuid } from "@/lib/admin/form";
import { automationState, markHandledManually, retryJob, saveRules, setAutomationSwitch } from "@/lib/admin/services/dropshipping";
import { saveMapping } from "@/lib/admin/services/suppliers";
import { processDueFulfillmentJobs } from "@/lib/fulfillment/worker";
import { syncSupplierOrders } from "@/lib/fulfillment/tracking-sync";
import { fromDecimalString } from "@/lib/money";

const done = (message: string) => {
  revalidatePath("/admin/dropshipping");
  return { ok: true as const, message };
};

/** "12.5" (percent) → 1250 basis points. */
const pct = (min: number, max: number) =>
  z.string().trim().regex(/^-?\d{1,3}(\.\d{1,2})?$/, "Percent, e.g. 15 or 12.5").transform((v) => Math.round(Number(v) * 100)).refine((v) => v >= min * 100 && v <= max * 100, `Between ${min} and ${max}`);
const list = (re: RegExp) =>
  z.string().trim().max(2000).transform((v) => [...new Set(v.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))]).refine((xs) => xs.every((x) => re.test(x)), "Invalid entry in the list");

export const setAutomationAction = adminAction("suppliers.manage", z.object({ enabled: bool }), async (i, { sql, actor }) => {
  const { sw } = await automationState(sql);
  await setAutomationSwitch(sql, actor, { ...sw, enabled: i.enabled });
  return done(i.enabled ? "Automatic purchasing is ON." : "Automatic purchasing is OFF. New paid orders go to the review queue.");
});

export const killSwitchAction = adminAction("suppliers.manage", z.object({ engage: bool }), async (i, { sql, actor }) => {
  const { sw } = await automationState(sql);
  await setAutomationSwitch(sql, actor, { ...sw, killSwitch: i.engage });
  return done(i.engage ? "KILL SWITCH ENGAGED — nothing will be sent to any supplier. Jobs wait safely." : "Kill switch released. Waiting jobs run on the next worker tick.");
});

export const saveRulesAction = adminAction(
  "suppliers.manage",
  z.object({
    maxPriceIncrease: pct(0, 100), minMargin: pct(-100, 100), maxPurchase: z.string().trim().min(1), maxPurchaseCurrency: currency,
    allowedCountries: list(/^[A-Z]{2}$/), allowedShippingMethods: list(/^[A-Z0-9_\-. ]{1,120}$/), maxAttempts: int(1, 20),
    useBackupSuppliers: bool, estimatedFee: pct(0, 20),
  }),
  async (i, { sql, actor }) => {
    let maxPurchaseAmount: number;
    try {
      maxPurchaseAmount = fromDecimalString(i.maxPurchase, i.maxPurchaseCurrency).amount;
    } catch {
      throw new UserError("Maximum purchase: enter an amount like 200 or 199.99");
    }
    await saveRules(sql, actor, {
      maxPriceIncreaseBps: i.maxPriceIncrease, minMarginBps: i.minMargin, maxPurchaseAmount, maxPurchaseCurrency: i.maxPurchaseCurrency,
      allowedCountries: i.allowedCountries, allowedShippingMethods: i.allowedShippingMethods, maxAttempts: i.maxAttempts,
      useBackupSuppliers: i.useBackupSuppliers, estimatedFeeBps: i.estimatedFee,
    });
    return done("Purchasing rules saved.");
  },
);

export const retryJobAction = adminAction("suppliers.manage", z.object({ orderId: uuid }), async (i, { sql, actor }) => {
  if (!(await retryJob(sql, actor, i.orderId))) throw new UserError("This order is not waiting for review.");
  return done("Back in the queue. It runs on the next worker tick (or press “Run worker now”).");
});

export const handledManuallyAction = adminAction("suppliers.manage", z.object({ orderId: uuid, note: optStr(500) }), async (i, { sql, actor }) => {
  if (!(await markHandledManually(sql, actor, i.orderId, i.note ?? ""))) throw new UserError("Nothing to resolve for this order.");
  return done("Marked as handled manually. Record the supplier order on the order page.");
});

export const runWorkerAction = adminAction("suppliers.manage", z.object({}), async (_i, { sql }) => {
  const jobs = await processDueFulfillmentJobs(sql, { limit: 5 });
  const sync = await syncSupplierOrders(sql, { limit: 20 });
  return done(`Worker ran: ${jobs.processed} job(s) (${jobs.results.map((r) => r.outcome).join(", ") || "none due"}), ${sync.synced} supplier order(s) synced${sync.errors ? `, ${sync.errors} sync error(s)` : ""}.`);
});

export const saveSourcingAction = adminAction(
  "suppliers.manage",
  z.object({
    supplierId: uuid, sku: reqStr(64), supplierSku: reqStr(120), cost: z.string().trim().min(1), costCurrency: currency, isPrimary: bool,
    daysMin: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(0).max(365).optional()),
    daysMax: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(0).max(365).optional()),
    supplierProductId: optStr(64), supplierVariantId: optStr(500), shippingMethod: optStr(120),
    shippingCost: z.string().trim().max(20).optional(), priority: int(0, 100), autoFulfill: bool,
  }),
  async (i, { sql, actor }) => {
    const toMinor = (v: string, label: string) => {
      try {
        return fromDecimalString(v, i.costCurrency).amount;
      } catch {
        throw new UserError(`${label}: enter an amount like 3.45`);
      }
    };
    if (i.supplierProductId && !/^\d{5,20}$/.test(i.supplierProductId)) throw new UserError("Supplier product id must be the numeric id from the supplier's product URL.");
    try {
      await saveMapping(sql, actor, {
        supplierId: i.supplierId, sku: i.sku, supplierSku: i.supplierSku, costAmount: toMinor(i.cost, "Unit cost"), costCurrency: i.costCurrency,
        isPrimary: i.isPrimary, daysMin: i.daysMin ?? null, daysMax: i.daysMax ?? null,
        sourcing: {
          supplierProductId: i.supplierProductId, supplierVariantId: i.supplierVariantId, shippingMethod: i.shippingMethod ? i.shippingMethod.toUpperCase() : null,
          shippingCost: i.shippingCost ? toMinor(i.shippingCost, "Shipping cost") : null, priority: i.priority, autoFulfill: i.autoFulfill,
        },
      });
    } catch (e) {
      if (e instanceof Error && /No variant with SKU/.test(e.message)) throw new UserError(e.message);
      throw e;
    }
    revalidatePath(`/admin/suppliers/${i.supplierId}`);
    return done("Sourcing saved.");
  },
);

export const saveSupplierCountriesAction = adminAction(
  "suppliers.manage",
  z.object({ supplierId: uuid, countries: list(/^[A-Z]{2}$/) }),
  async (i, { sql, actor }) => {
    await sql`update public.suppliers set supported_countries = ${i.countries} where id = ${i.supplierId}`;
    const { logActivity } = await import("@/lib/admin/audit");
    await logActivity(sql, actor, { action: "supplier.countries", entity: "supplier", entityId: i.supplierId, summary: `Ships to: ${i.countries.join(", ") || "any"}` });
    revalidatePath(`/admin/suppliers/${i.supplierId}`);
    return done("Destination countries saved.");
  },
);

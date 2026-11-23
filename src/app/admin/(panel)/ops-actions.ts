"use server";
import { revalidatePath } from "next/cache";
import { expirePublicData, STOREFRONT_TAG } from "@/lib/cache/public-data";
import { z } from "zod";
import { adminAction, UserError } from "@/lib/admin/guard";
import { bool, currency, int, money as moneyField, optInt, optMoneyAny, optStr, optUuid, reqStr, str, strList, uuid } from "@/lib/admin/form";
import { ADMIN_ROLES } from "@/lib/admin/permissions";
import { logActivity } from "@/lib/admin/audit";
import { saveCoupon } from "@/lib/admin/services/coupons";
import { addLegalTemplates, savePage, setPagePublished } from "@/lib/admin/services/content";
import { addExpense, addRate, deleteExpense } from "@/lib/admin/services/finance";
import { markRead, markUnread } from "@/lib/admin/services/notifications";
import { inviteAdmin, moderateReview, resetAdminPassword, updateAdmin } from "@/lib/admin/services/people";
import { setSetting } from "@/lib/admin/services/settings";
import { deleteShippingEntity, saveMethod, saveZone } from "@/lib/admin/services/shipping";
import { deleteMapping, saveMapping, saveSupplier } from "@/lib/admin/services/suppliers";
import { AuthError } from "@/lib/admin/auth";
import { fromDecimalString } from "@/lib/money";
import { MAX_SUPPORTERS, normalizeSupporters, SUPPORTERS_KEY } from "@/lib/storefront/supporters";

async function friendly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthError || (e instanceof Error && !("code" in e) && e.constructor === Error)) throw new UserError(e.message);
    throw e;
  }
}

// ───────────────── Suppliers ─────────────────
export const saveSupplierAction = adminAction(
  "suppliers.manage",
  z.object({
    id: optUuid, name: reqStr(120), adapterKey: z.enum(["manual", "aliexpress", "alibaba", "mock"]), fulfillmentMode: z.enum(["manual", "api"]), isActive: bool,
    contactEmail: optStr(254), website: optStr(300), notes: str(2000), defaultCurrency: currency, leadTimeDays: optInt(0, 365),
  }),
  async (i, { sql, actor }) => {
    await saveSupplier(sql, actor, { ...i, id: i.id ?? undefined });
    revalidatePath("/admin/suppliers");
    return { ok: true, message: "Supplier saved." };
  },
);

export const saveMappingAction = adminAction(
  "suppliers.manage",
  z.object({ supplierId: uuid, sku: reqStr(64), supplierSku: reqStr(120), cost: moneyField("EUR"), costCurrency: currency, isPrimary: bool, daysMin: optInt(0, 365), daysMax: optInt(0, 365) }),
  async (i, { sql, actor }) => {
    await friendly(() => saveMapping(sql, actor, { ...i, costAmount: i.cost }));
    revalidatePath(`/admin/suppliers/${i.supplierId}`);
    return { ok: true, message: "Mapping saved." };
  },
);

export const deleteMappingAction = adminAction("suppliers.manage", z.object({ supplierId: uuid, mappingId: uuid }), async (i, { sql, actor }) => {
  await deleteMapping(sql, actor, i.supplierId, i.mappingId);
  revalidatePath(`/admin/suppliers/${i.supplierId}`);
  return { ok: true };
});

// ───────────────── Shipping ─────────────────
export const saveZoneAction = adminAction(
  "shipping.manage",
  z.object({ id: optUuid, name: reqStr(120), countries: reqStr(600), isActive: bool, sortOrder: int(0, 1000) }),
  async (i, { sql, actor }) => {
    await friendly(() => saveZone(sql, actor, { ...i, id: i.id ?? undefined, countries: i.countries.split(/[\s,;]+/) }));
    revalidatePath("/admin/shipping");
    return { ok: true, message: "Zone saved." };
  },
);

export const saveMethodAction = adminAction(
  "shipping.manage",
  z.object({
    id: optUuid, zoneId: uuid, name: reqStr(120), carrier: optStr(80), rateType: z.enum(["fixed", "weight", "order_value"]), currency,
    fixedAmount: optMoneyAny, freeOverAmount: optMoneyAny, minDays: optInt(0, 120), maxDays: optInt(0, 120), isActive: bool, tiers: str(4000),
  }),
  async (i, { sql, actor }) => {
    // Tiers: one per line "min-max: price" (max may be empty = and above). Weight in grams; order value in decimal money.
    const rates = i.tiers.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const m = /^([\d.]+)\s*-\s*([\d.]*)\s*:\s*([\d.]+)$/.exec(line);
      if (!m) throw new UserError(`Tier “${line}” must look like “0-2000: 6.90”`);
      const toMinor = (v: string) => fromDecimalString(v, i.currency).amount; // exact, no float math
      if (i.rateType === "weight" && [m[1], m[2]].some((x) => x && !/^d+$/.test(x))) throw new UserError(`Weights are whole grams in “${line}”`);
      const bound = (v: string) => (i.rateType === "weight" ? Number(v) : toMinor(v));
      if (![m[1], m[3]].every((x) => /^\d+(\.\d{1,2})?$/.test(x!))) throw new UserError(`Invalid number in “${line}”`);
      return { minValue: bound(m[1]!), maxValue: m[2] ? bound(m[2]) : null, amount: toMinor(m[3]!) };
    });
    await friendly(() => saveMethod(sql, actor, { ...i, id: i.id ?? undefined, rates }));
    revalidatePath("/admin/shipping");
    return { ok: true, message: "Method saved." };
  },
);

export const deleteShippingAction = adminAction("shipping.manage", z.object({ kind: z.enum(["zone", "method"]), id: uuid }), async (i, { sql, actor }) => {
  await deleteShippingEntity(sql, actor, i.kind, i.id);
  revalidatePath("/admin/shipping");
  return { ok: true };
});

// ───────────────── Finance ─────────────────
export const addRateAction = adminAction(
  "finance.manage",
  z.object({ base: currency, quote: currency, rate: z.string().trim().regex(/^\d+(\.\d{1,8})?$/, "Up to 8 decimals"), effectiveAt: z.string().optional() }),
  async (i, { sql, actor }) => {
    const effectiveAt = i.effectiveAt ? new Date(i.effectiveAt) : new Date();
    if (Number.isNaN(effectiveAt.getTime())) throw new UserError("Invalid date");
    await friendly(() => addRate(sql, actor, { base: i.base, quote: i.quote, rate: i.rate, effectiveAt }));
    revalidatePath("/admin/payments");
    return { ok: true, message: "Rate recorded. Existing orders keep their own snapshot." };
  },
);

export const addExpenseAction = adminAction(
  "finance.manage",
  z.object({ category: z.enum(["advertising", "software", "shipping_supplies", "fees", "salaries", "other"]), description: reqStr(500), amount: moneyField("EUR"), currency, incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  async (i, { sql, actor }) => {
    await addExpense(sql, actor, i);
    revalidatePath("/admin/analytics");
    return { ok: true, message: "Expense recorded." };
  },
);

export const deleteExpenseAction = adminAction("finance.manage", z.object({ id: uuid }), async (i, { sql, actor }) => {
  await deleteExpense(sql, actor, i.id);
  revalidatePath("/admin/analytics");
  return { ok: true };
});

// ───────────────── Discounts ─────────────────
export const saveCouponAction = adminAction(
  "discounts.manage",
  z.object({
    id: optUuid, code: reqStr(40), name: str(120), kind: z.enum(["percent", "fixed"]), percent: z.string().optional(), amount: optMoneyAny,
    currency: z.preprocess((v) => (v === "" ? undefined : v), currency.optional()), minSubtotal: optMoneyAny, startsAt: str(30), endsAt: str(30),
    maxRedemptions: optInt(1, 1_000_000), perCustomerLimit: optInt(1, 1000), isActive: bool, appliesTo: z.enum(["all", "category", "product"]), targetIds: strList,
  }),
  async (i, { sql, actor }) => {
    let basisPoints: number | null = null;
    if (i.kind === "percent") {
      const pct = Number(i.percent);
      if (!/^\d+(\.\d{1,2})?$/.test(i.percent ?? "") || pct <= 0 || pct > 100) throw new UserError("Percent must be between 0.01 and 100");
      basisPoints = fromDecimalString(i.percent!, "EUR").amount; // exact percent → basis points
    }
    if (i.kind === "fixed" && (i.amount === null || !i.currency)) throw new UserError("A fixed discount needs an amount and a currency");
    if (i.minSubtotal !== null && !i.currency) throw new UserError("A minimum order amount needs a currency");
    const date = (s: string) => (s ? new Date(s) : null);
    const startsAt = date(i.startsAt), endsAt = date(i.endsAt);
    if ((startsAt && Number.isNaN(startsAt.getTime())) || (endsAt && Number.isNaN(endsAt.getTime()))) throw new UserError("Invalid date");
    if (startsAt && endsAt && endsAt <= startsAt) throw new UserError("End must be after start");
    const targetIds = i.targetIds.filter((x) => /^[0-9a-f-]{36}$/.test(x));
    if (i.appliesTo !== "all" && targetIds.length === 0) throw new UserError("Pick at least one category/product");
    await friendly(() => saveCoupon(sql, actor, {
      id: i.id ?? undefined, code: i.code, name: i.name, kind: i.kind, basisPoints, amount: i.kind === "fixed" ? i.amount : null, currency: i.currency ?? null,
      minSubtotal: i.minSubtotal, startsAt, endsAt, maxRedemptions: i.maxRedemptions, perCustomerLimit: i.perCustomerLimit, isActive: i.isActive, appliesTo: i.appliesTo, targetIds,
    }));
    revalidatePath("/admin/discounts");
    return { ok: true, message: "Discount saved." };
  },
);

// ───────────────── Reviews ─────────────────
export const moderateAction = adminAction("reviews.moderate", z.object({ id: uuid, status: z.enum(["approved", "rejected", "hidden", "pending"]) }), async (i, { sql, actor }) => {
  await friendly(() => moderateReview(sql, actor, i.id, i.status));
  revalidatePath("/admin/reviews");
  return { ok: true };
});

// ───────────────── Content ─────────────────
export const homeContentAction = adminAction(
  "content.manage",
  z.object({ heroEyebrow: str(80), heroTitle: str(120), heroSubtitle: str(400), announcement: str(200) }),
  async (i, { sql, actor }) => {
    await setSetting(sql, actor, "storefront.home", i);
    expirePublicData(STOREFRONT_TAG);
    revalidatePath("/");
    revalidatePath("/", "layout");
    return { ok: true, message: "Homepage content published." };
  },
);

export const savePageAction = adminAction("content.manage", z.object({ id: optUuid, slug: str(80), title: reqStr(200), body: str(100_000) }), async (i, { sql, actor }) => {
  await friendly(() => savePage(sql, actor, { ...i, id: i.id ?? undefined }));
  revalidatePath("/admin/content");
  return { ok: true, message: "Draft saved (not yet public)." };
});

export const addLegalPagesAction = adminAction("content.manage", z.object({}), async (_i, { sql, actor }) => {
  const added = await addLegalTemplates(sql, actor);
  revalidatePath("/admin/content");
  return { ok: true, message: added.length ? `Added ${added.length} draft page(s): ${added.join(", ")}. Open each one, fill the [brackets], then Publish.` : "All legal pages already exist — nothing changed." };
});

export const publishPageAction = adminAction("content.manage", z.object({ id: uuid, publish: bool }), async (i, { sql, actor }) => {
  await friendly(() => setPagePublished(sql, actor, i.id, i.publish));
  expirePublicData(STOREFRONT_TAG);
  revalidatePath("/", "layout"); // footer lists published pages
  revalidatePath("/admin/content");
  revalidatePath("/pages/[slug]", "page");
  return { ok: true, message: i.publish ? "Published." : "Unpublished." };
});

// ───────────────── Settings ─────────────────
export const settingsAction = adminAction(
  "settings.manage",
  z.object({
    storeName: reqStr(120), supportEmail: optStr(254), baseCurrency: currency, lowStock: int(0, 100000), stockAllFaces: bool,
    legalName: str(200), address: str(500), vatNumber: str(40), sellerEmail: str(254),
  }),
  async (i, { sql, actor }) => {
    await setSetting(sql, actor, "store.name", i.storeName);
    await setSetting(sql, actor, "store.support_email", i.supportEmail);
    await setSetting(sql, actor, "store.base_currency", i.baseCurrency);
    await setSetting(sql, actor, "store.default_low_stock_threshold", i.lowStock);
    await setSetting(sql, actor, "store.stock_all_faces", i.stockAllFaces);
    await setSetting(sql, actor, "store.seller", { legalName: i.legalName, address: i.address, vatNumber: i.vatNumber, email: i.sellerEmail });
    expirePublicData(STOREFRONT_TAG);
    revalidatePath("/");
    revalidatePath("/store");
    revalidatePath("/admin/settings");
    return { ok: true, message: "Settings saved." };
  },
);

export const taxRateAction = adminAction(
  "settings.manage",
  z.object({ id: optUuid, country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "2-letter code"), region: optStr(10), mode: z.enum(["inclusive", "exclusive"]), percent: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "e.g. 22 or 7.25"), isActive: bool, note: str(300) }),
  async (i, { sql, actor }) => {
    const bps = fromDecimalString(i.percent, "EUR").amount; // "7.25" → 725 basis points, exact
    if (i.id) {
      await sql`update public.tax_rates set country = ${i.country}, region = ${i.region}, mode = ${i.mode}, basis_points = ${bps}, is_active = ${i.isActive}, note = ${i.note} where id = ${i.id}`;
    } else {
      await sql`insert into public.tax_rates (country, region, mode, basis_points, is_active, note) values (${i.country}, ${i.region}, ${i.mode}, ${bps}, ${i.isActive}, ${i.note})`;
    }
    await logActivity(sql, actor, { action: "tax.save", entity: "tax_rate", entityId: i.id, summary: `${i.country}${i.region ? `-${i.region}` : ""}: ${i.percent}% ${i.mode}`, after: i });
    revalidatePath("/admin/settings");
    return { ok: true, message: "Tax rate saved." };
  },
);

// ───────────────── Admin users ─────────────────
export const inviteAdminAction = adminAction(
  "admins.manage",
  z.object({ email: z.string().trim().email(), fullName: str(200), role: z.enum(ADMIN_ROLES), password: z.string().min(1).max(200) }),
  async (i, { sql, actor, session }) => {
    await friendly(() => inviteAdmin(sql, { ...actor, role: session.user.role }, i));
    revalidatePath("/admin/admins");
    return { ok: true, message: `Added ${i.email}. Share the temporary password through a secure channel and ask them to change it.` };
  },
);

export const updateAdminAction = adminAction(
  "admins.manage",
  z.object({ id: uuid, role: z.enum(ADMIN_ROLES), isActive: bool, fullName: str(200), extra: strList, keep: strList, defaults: strList }),
  async (i, { sql, actor, session }) => {
    // Unticked role defaults become revocations; ticked non-defaults become extra grants.
    const revoked = i.defaults.filter((d) => !i.keep.includes(d));
    await friendly(() => updateAdmin(sql, { ...actor, role: session.user.role }, { id: i.id, role: i.role, isActive: i.isActive, fullName: i.fullName, extra: i.extra, revoked }));
    revalidatePath("/admin/admins");
    return { ok: true, message: "Admin updated." };
  },
);

export const resetPasswordAction = adminAction("admins.manage", z.object({ id: uuid, password: z.string().min(1).max(200) }), async (i, { sql, actor, session }) => {
  await friendly(() => resetAdminPassword(sql, { ...actor, role: session.user.role }, i.id, i.password));
  revalidatePath("/admin/admins");
  return { ok: true, message: "Password reset; their sessions were signed out." };
});

export const ownPasswordAction = adminAction("dashboard.view", z.object({ password: z.string().min(1).max(200), confirm: z.string() }), async (i, { sql, actor, session }) => {
  if (i.password !== i.confirm) throw new UserError("Passwords don't match");
  await friendly(() => resetAdminPassword(sql, { ...actor, role: session.user.role }, actor.id, i.password));
  return { ok: true, message: "Password changed. Please sign in again." };
});

// ───────────────── Notifications ─────────────────
export const markReadAction = adminAction("notifications.view", z.object({ id: z.string(), unread: bool }), async (i, { sql, session }) => {
  if (i.id === "all") await markRead(sql, session.user.id, "all");
  else if (/^[0-9a-f-]{36}$/.test(i.id)) {
    if (i.unread) await markUnread(sql, session.user.id, i.id);
    else await markRead(sql, session.user.id, [i.id]);
  }
  revalidatePath("/admin", "layout");
  return { ok: true };
});

// ───────────────── 3D store supporters wall (super admin) ─────────────────
export const saveSupportersAction = adminAction(
  "admins.manage",
  z.object({ title: str(80), people: z.string().max(400_000) }),
  async (i, { sql, actor }) => {
    let raw: unknown;
    try {
      raw = JSON.parse(i.people || "[]");
    } catch {
      throw new UserError("The list could not be read. Reload the page and try again.");
    }
    if (!Array.isArray(raw)) throw new UserError("The list could not be read. Reload the page and try again.");
    if (raw.length > MAX_SUPPORTERS) throw new UserError(`At most ${MAX_SUPPORTERS} names.`);
    const wall = normalizeSupporters({ title: i.title, people: raw });
    await setSetting(sql, actor, SUPPORTERS_KEY, wall);
    expirePublicData(STOREFRONT_TAG);
    revalidatePath("/store");
    revalidatePath("/");
    revalidatePath("/admin/supporters");
    return { ok: true, message: `Saved ${wall.people.length} ${wall.people.length === 1 ? "name" : "names"}. The 3D store shows them within a minute.` };
  },
);

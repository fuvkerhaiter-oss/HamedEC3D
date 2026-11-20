/** Shipping zones/methods/rates from the DB (admin-configured) + quoting. */
import { inTx, type Db } from "../../db/client";
import type { CurrencyCode } from "../../money";
import { tierProblem, type RateType, type ShippingZoneConfig } from "../../shipping/quote";
import { logActivity, type Actor } from "../audit";

export async function loadShippingZones(db: Db, opts: { includeInactive?: boolean } = {}): Promise<ShippingZoneConfig[]> {
  const zones = await db<{ id: string; name: string; countries: string[]; is_active: boolean; sort_order: number }[]>`
    select * from public.shipping_zones where (${opts.includeInactive ?? false} or is_active) order by sort_order, name`;
  const methods = await db<{
    id: string; zone_id: string; name: string; carrier: string | null; rate_type: RateType; currency: CurrencyCode;
    fixed_amount: number | null; free_over_amount: number | null; min_days: number | null; max_days: number | null; is_active: boolean; sort_order: number;
  }[]>`select * from public.shipping_methods order by sort_order, name`;
  const rates = await db<{ id: string; method_id: string; min_value: number; max_value: number | null; amount: number }[]>`
    select * from public.shipping_rates order by min_value`;
  return zones.map((z) => ({
    id: z.id, name: z.name, countries: z.countries, isActive: z.is_active, sortOrder: z.sort_order,
    methods: methods.filter((m) => m.zone_id === z.id && (opts.includeInactive || m.is_active)).map((m) => ({
      id: m.id, name: m.name, carrier: m.carrier, rateType: m.rate_type, currency: m.currency, fixedAmount: m.fixed_amount,
      freeOverAmount: m.free_over_amount, minDays: m.min_days, maxDays: m.max_days, isActive: m.is_active, sortOrder: m.sort_order,
      rates: rates.filter((r) => r.method_id === m.id).map((r) => ({ minValue: r.min_value, maxValue: r.max_value, amount: r.amount })),
    })),
  }));
}

export async function saveZone(db: Db, actor: Actor, z: { id?: string; name: string; countries: string[]; isActive: boolean; sortOrder: number }) {
  const countries = [...new Set(z.countries.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
  if (!countries.length) throw new Error("Add at least one 2-letter country code");
  const vals = { name: z.name, countries, is_active: z.isActive, sort_order: z.sortOrder };
  if (z.id) await db`update public.shipping_zones set ${db(vals)} where id = ${z.id}`;
  else z.id = (await db<{ id: string }[]>`insert into public.shipping_zones ${db(vals)} returning id`)[0]!.id;
  await logActivity(db, actor, { action: "shipping.zone.save", entity: "shipping_zone", entityId: z.id, summary: `Saved zone ${z.name}`, after: vals });
  return z.id;
}

export interface MethodInput {
  id?: string;
  zoneId: string;
  name: string;
  carrier: string | null;
  rateType: RateType;
  currency: CurrencyCode;
  fixedAmount: number | null;
  freeOverAmount: number | null;
  minDays: number | null;
  maxDays: number | null;
  isActive: boolean;
  rates: { minValue: number; maxValue: number | null; amount: number }[];
}

export async function saveMethod(db: Db, actor: Actor, m: MethodInput) {
  if (m.rateType === "fixed" && m.fixedAmount === null) throw new Error("A fixed-rate method needs an amount");
  if (m.rateType !== "fixed") {
    if (!m.rates.length) throw new Error("Add at least one rate tier");
    const p = tierProblem(m.rates);
    if (p) throw new Error(p);
  }
  if (m.minDays !== null && m.maxDays !== null && m.maxDays < m.minDays) throw new Error("Max days must be ≥ min days");
  return inTx(db, async (tx) => {
    const vals = {
      zone_id: m.zoneId, name: m.name, carrier: m.carrier, rate_type: m.rateType, currency: m.currency,
      fixed_amount: m.rateType === "fixed" ? m.fixedAmount : null, free_over_amount: m.freeOverAmount,
      min_days: m.minDays, max_days: m.maxDays, is_active: m.isActive,
    };
    let id = m.id;
    if (id) await tx`update public.shipping_methods set ${tx(vals)} where id = ${id}`;
    else id = (await tx<{ id: string }[]>`insert into public.shipping_methods ${tx(vals)} returning id`)[0]!.id;
    await tx`delete from public.shipping_rates where method_id = ${id}`;
    if (m.rateType !== "fixed") {
      for (const r of m.rates) await tx`insert into public.shipping_rates (method_id, min_value, max_value, amount) values (${id}, ${r.minValue}, ${r.maxValue}, ${r.amount})`;
    }
    await logActivity(tx, actor, { action: "shipping.method.save", entity: "shipping_method", entityId: id, summary: `Saved method ${m.name}`, after: m });
    return id;
  });
}

export async function deleteShippingEntity(db: Db, actor: Actor, kind: "zone" | "method", id: string) {
  if (kind === "zone") await db`delete from public.shipping_zones where id = ${id}`;
  else await db`delete from public.shipping_methods where id = ${id}`;
  await logActivity(db, actor, { action: `shipping.${kind}.delete`, entity: `shipping_${kind}`, entityId: id, summary: `Deleted shipping ${kind}` });
}

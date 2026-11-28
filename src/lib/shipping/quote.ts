/**
 * Shipping rate calculation from admin-configured zones/methods/rates. Pure (unit tested).
 * Rate types: fixed, weight tiers (grams), order-value tiers (minor units). Optional free-shipping threshold.
 * Tiers are half-open [minValue, maxValue); maxValue null = no upper bound.
 */
import { fromDecimalString, money, type CurrencyCode, type Money } from "../money";

export type RateType = "fixed" | "weight" | "order_value";

export interface ShippingRateTier {
  minValue: number;
  maxValue: number | null;
  amount: number;
}

export interface ShippingMethodConfig {
  id: string;
  name: string;
  carrier: string | null;
  rateType: RateType;
  currency: CurrencyCode;
  fixedAmount: number | null;
  freeOverAmount: number | null;
  minDays: number | null;
  maxDays: number | null;
  isActive: boolean;
  sortOrder?: number;
  rates: ShippingRateTier[];
}

export interface ShippingZoneConfig {
  id: string;
  name: string;
  countries: string[];
  isActive: boolean;
  sortOrder?: number;
  methods: ShippingMethodConfig[];
}

export interface ShippingQuoteInput {
  country: string;
  currency: CurrencyCode;
  /** Goods subtotal after discounts, minor units of `currency`. */
  subtotal: number;
  weightGrams: number;
}

export interface ShippingOption {
  methodId: string;
  zoneId: string;
  name: string;
  carrier: string | null;
  amount: Money;
  isFree: boolean;
  minDays: number | null;
  maxDays: number | null;
}

export function findZone(zones: readonly ShippingZoneConfig[], country: string): ShippingZoneConfig | null {
  const cc = country.toUpperCase();
  return [...zones]
    .filter((z) => z.isActive && z.countries.map((c) => c.toUpperCase()).includes(cc))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0] ?? null;
}

function tierAmount(tiers: readonly ShippingRateTier[], value: number): number | null {
  const t = tiers.find((r) => value >= r.minValue && (r.maxValue === null || value < r.maxValue));
  return t ? t.amount : null;
}

/** Price of one method for the cart, or null when the method doesn't apply (no matching tier). */
export function methodPrice(m: ShippingMethodConfig, input: ShippingQuoteInput): number | null {
  if (!m.isActive || m.currency !== input.currency) return null;
  let amount: number | null;
  if (m.rateType === "fixed") amount = m.fixedAmount;
  else if (m.rateType === "weight") amount = tierAmount(m.rates, Math.max(0, input.weightGrams));
  else amount = tierAmount(m.rates, Math.max(0, input.subtotal));
  if (amount === null) return null;
  if (m.freeOverAmount !== null && input.subtotal >= m.freeOverAmount) return 0;
  return amount;
}

/** All available options for the destination, cheapest first. Empty = we don't ship there in this currency. */
export function quoteShipping(zones: readonly ShippingZoneConfig[], input: ShippingQuoteInput): ShippingOption[] {
  if (!Number.isSafeInteger(input.subtotal) || !Number.isSafeInteger(input.weightGrams)) throw new Error("Invalid quote input");
  const zone = findZone(zones, input.country);
  if (!zone) return [];
  const out: ShippingOption[] = [];
  for (const m of [...zone.methods].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    const price = methodPrice(m, input);
    if (price === null) continue;
    out.push({
      methodId: m.id,
      zoneId: zone.id,
      name: m.name,
      carrier: m.carrier,
      amount: money(price, input.currency),
      isFree: price === 0,
      minDays: m.minDays,
      maxDays: m.maxDays,
    });
  }
  return out.sort((a, b) => a.amount.amount - b.amount.amount);
}

/** Validates tiers: non-overlapping, sorted, non-negative. Returns a problem description or null. */
export function tierProblem(tiers: readonly ShippingRateTier[]): string | null {
  const sorted = [...tiers].sort((a, b) => a.minValue - b.minValue);
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!;
    if (t.minValue < 0 || t.amount < 0) return "Values must be ≥ 0";
    if (t.maxValue !== null && t.maxValue <= t.minValue) return "Each tier's upper bound must be above its lower bound";
    const next = sorted[i + 1];
    if (next && (t.maxValue === null || t.maxValue > next.minValue)) return "Tiers overlap";
  }
  return null;
}

export interface CountryCoverage {
  country: string;
  currency: CurrencyCode;
  /** True when an active zone covers the country AND has at least one active method priced in its currency. */
  shippable: boolean;
  /** Why not (admin-facing), or null when shippable. */
  problem: string | null;
}

/**
 * Which sales-market countries can actually be quoted. Used to offer only real destinations at checkout and to show
 * the admin exactly what is missing (no zone, or a zone whose methods are priced in the wrong currency).
 * A method with tiers may still refuse a specific cart (weight/value outside every tier); that is reported per quote.
 */
export function shippingCoverage(
  zones: readonly ShippingZoneConfig[],
  countries: readonly { country: string; currency: CurrencyCode }[],
): CountryCoverage[] {
  return countries.map(({ country, currency }) => {
    const zone = findZone(zones, country);
    if (!zone) return { country, currency, shippable: false, problem: "no active shipping zone includes this country" };
    const active = zone.methods.filter((m) => m.isActive);
    if (!active.length) return { country, currency, shippable: false, problem: `zone "${zone.name}" has no active method` };
    const priced = active.filter((m) => m.currency === currency && (m.rateType === "fixed" ? m.fixedAmount !== null : m.rates.length > 0));
    if (!priced.length) {
      const other = [...new Set(active.map((m) => m.currency))].join("/");
      return { country, currency, shippable: false, problem: `zone "${zone.name}" has methods in ${other} only; customers here pay in ${currency}` };
    }
    return { country, currency, shippable: true, problem: null };
  });
}

/**
 * Parses the admin's tier text ("min-max: price", one per line; empty max = "and above").
 * Weight bounds are whole grams; order-value bounds and prices are decimal money in the method's currency,
 * converted exactly (no float math). Throws an Error with an admin-readable message on the first bad line.
 */
export function parseRateTiers(text: string, rateType: RateType, currency: CurrencyCode): ShippingRateTier[] {
  const toMinor = (v: string): number => fromDecimalString(v, currency).amount;
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const m = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)?\s*:\s*(\d+(?:\.\d+)?)$/.exec(line);
    if (!m) throw new Error(`Tier “${line}” must look like “0-2000: 6.90”`);
    const [, min, max, price] = m;
    if (rateType === "weight" && [min, max].some((x) => x !== undefined && !/^\d+$/.test(x))) throw new Error(`Weights are whole grams in “${line}”`);
    const money2 = /^\d+(\.\d{1,2})?$/;
    if (![price, ...(rateType === "order_value" ? [min, max] : [])].every((x) => x === undefined || money2.test(x))) {
      throw new Error(`Use at most 2 decimals in “${line}”`);
    }
    const bound = (v: string) => (rateType === "weight" ? Number(v) : toMinor(v));
    return { minValue: bound(min!), maxValue: max !== undefined ? bound(max) : null, amount: toMinor(price!) };
  });
}

/**
 * Normalises a zone's country list (ISO 3166-1 alpha-2, spaces/commas/semicolons) and rejects codes this store
 * does not sell to, so a typo ("UK", "GR" vs "EL") can't silently leave a country unshippable.
 */
export function parseZoneCountries(text: string, allowed: readonly string[]): { countries: string[]; unknown: string[] } {
  const codes = [...new Set(text.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const ok = new Set(allowed);
  return { countries: codes.filter((c) => ok.has(c)), unknown: codes.filter((c) => !ok.has(c)) };
}

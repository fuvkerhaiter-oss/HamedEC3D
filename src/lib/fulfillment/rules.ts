/**
 * Automatic-purchasing rules and safety checks. Pure (unit tested): the worker gathers live supplier data,
 * converts money to the order currency, and asks these functions whether a purchase is safe.
 * Anything that fails here goes to the exception queue (manual review) — never silently purchased.
 */
import { z } from "zod";

export const automationSwitchSchema = z.object({
  /** Automatic supplier purchasing on/off. OFF by default. */
  enabled: z.boolean().default(false),
  /** Emergency stop: nothing is submitted to any supplier while true (jobs wait, nothing is lost). */
  killSwitch: z.boolean().default(false),
});
export type AutomationSwitch = z.infer<typeof automationSwitchSchema>;

export const purchasingRulesSchema = z.object({
  /** Max accepted live supplier unit-cost increase over the mapped cost, in basis points (1000 = 10 %). */
  maxPriceIncreaseBps: z.number().int().min(0).max(10_000).default(1000),
  /** Minimum margin after supplier cost, supplier shipping and payment fee, in basis points of net revenue. */
  minMarginBps: z.number().int().min(-10_000).max(10_000).default(1500),
  /** Max total for ONE supplier purchase (goods + shipping), in minor units of maxPurchaseCurrency. */
  maxPurchaseAmount: z.number().int().min(0).max(100_000_000).default(20_000),
  maxPurchaseCurrency: z.enum(["EUR", "USD"]).default("USD"),
  /** Destination countries allowed for automatic purchasing (ISO alpha-2). Empty = every country we ship to. */
  allowedCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250).default([]),
  /** Supplier shipping methods allowed (e.g. CAINIAO_STANDARD). Empty = any mapped method. */
  allowedShippingMethods: z.array(z.string().min(1).max(120)).max(100).default([]),
  /** Automatic attempts per order before it goes to the failed-jobs queue. */
  maxAttempts: z.number().int().min(1).max(20).default(5),
  /** Try backup suppliers (non-primary mappings, by priority) when the first choice fails a check. */
  useBackupSuppliers: z.boolean().default(true),
  /** Payment fee estimate used for the margin check until the real fee is known, in basis points. */
  estimatedFeeBps: z.number().int().min(0).max(2000).default(300),
});
export type PurchasingRules = z.infer<typeof purchasingRulesSchema>;

export const DEFAULT_RULES: PurchasingRules = purchasingRulesSchema.parse({});
export const DEFAULT_SWITCH: AutomationSwitch = automationSwitchSchema.parse({});

/** Stored settings → validated values (invalid stored values fall back to safe defaults field by field). */
export function parseRules(v: unknown): PurchasingRules {
  const r = purchasingRulesSchema.safeParse(v ?? {});
  if (r.success) return r.data;
  const out: Record<string, unknown> = { ...DEFAULT_RULES };
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v)) {
      const field = (purchasingRulesSchema.shape as Record<string, z.ZodType>)[k];
      if (field?.safeParse(val).success) out[k] = val;
    }
  }
  return purchasingRulesSchema.parse(out);
}
export function parseSwitch(v: unknown): AutomationSwitch {
  const r = automationSwitchSchema.safeParse(v ?? {});
  // Unreadable switch = treat as stopped (fail closed).
  return r.success ? r.data : { enabled: false, killSwitch: true };
}

// ───────────────────────── Line candidate check ─────────────────────────

export interface CandidateCheckInput {
  quantity: number;
  /** Mapped (expected) unit cost, in the mapping currency. */
  expectedUnitCost: number;
  /** Live unit cost in the SAME currency, or null when the supplier cannot quote. */
  liveUnitCost: number | null;
  /** Live stock, or null when the supplier cannot tell. */
  liveAvailable: number | null;
  autoFulfill: boolean;
  supplierActive: boolean;
  /** Supplier's supported destination countries (empty = any). */
  supplierCountries: readonly string[];
  shipCountry: string;
  shippingMethod: string | null;
  /** Adapter needs a shipping method to place orders (API suppliers). */
  requiresShippingMethod: boolean;
}

export function checkCandidate(i: CandidateCheckInput, rules: PurchasingRules): string[] {
  const problems: string[] = [];
  if (!i.supplierActive) problems.push("supplier is inactive");
  if (!i.autoFulfill) problems.push("automatic fulfillment is disabled for this product mapping");
  if (i.supplierCountries.length && !i.supplierCountries.includes(i.shipCountry)) problems.push(`supplier does not ship to ${i.shipCountry}`);
  if (i.liveAvailable !== null && i.liveAvailable < i.quantity) problems.push(`out of stock at supplier (${i.liveAvailable} available, ${i.quantity} needed)`);
  if (i.liveUnitCost !== null && i.expectedUnitCost >= 0) {
    const limit = i.expectedUnitCost + Math.floor((i.expectedUnitCost * rules.maxPriceIncreaseBps) / 10_000);
    if (i.liveUnitCost > limit) {
      const pct = i.expectedUnitCost > 0 ? (((i.liveUnitCost - i.expectedUnitCost) / i.expectedUnitCost) * 100).toFixed(1) : "∞";
      problems.push(`supplier price rose ${pct}% (from ${i.expectedUnitCost} to ${i.liveUnitCost} minor units; limit ${rules.maxPriceIncreaseBps / 100}%)`);
    }
  }
  if (i.requiresShippingMethod && !i.shippingMethod) problems.push("no supplier shipping method mapped");
  if (i.shippingMethod && rules.allowedShippingMethods.length && !rules.allowedShippingMethods.includes(i.shippingMethod)) {
    problems.push(`shipping method ${i.shippingMethod} is not allowed`);
  }
  return problems;
}

// ───────────────────────── Purchase (per supplier) check ─────────────────────────

export interface PurchaseCheckInput {
  /** Net revenue for these lines (customer paid, excluding tax), in order currency minor units. */
  revenue: number;
  /** Supplier goods + shipping cost converted to the order currency; null when not convertible. */
  costInOrderCurrency: number | null;
  /** Supplier goods + shipping converted to rules.maxPurchaseCurrency; null when not convertible. */
  costInLimitCurrency: number | null;
  /** Actual payment fee share if known, else null (estimatedFeeBps is used). */
  paymentFee: number | null;
}

export interface PurchaseCheck {
  ok: boolean;
  problems: string[];
  marginBps: number | null;
  profit: number | null;
}

export function checkPurchase(i: PurchaseCheckInput, rules: PurchasingRules): PurchaseCheck {
  const problems: string[] = [];
  if (i.costInOrderCurrency === null) problems.push("supplier cost cannot be converted to the order currency (add an exchange rate)");
  if (i.costInLimitCurrency === null) problems.push(`supplier cost cannot be converted to ${rules.maxPurchaseCurrency} for the purchase limit`);
  else if (i.costInLimitCurrency > rules.maxPurchaseAmount) problems.push(`purchase ${i.costInLimitCurrency} exceeds the limit ${rules.maxPurchaseAmount} ${rules.maxPurchaseCurrency} (minor units)`);
  let marginBps: number | null = null;
  let profit: number | null = null;
  if (i.costInOrderCurrency !== null) {
    const fee = i.paymentFee ?? Math.ceil((i.revenue * rules.estimatedFeeBps) / 10_000);
    profit = i.revenue - i.costInOrderCurrency - fee;
    marginBps = i.revenue > 0 ? Math.floor((profit * 10_000) / i.revenue) : null;
    if (marginBps === null || marginBps < rules.minMarginBps) {
      problems.push(`margin ${marginBps === null ? "n/a" : (marginBps / 100).toFixed(1) + "%"} is below the minimum ${(rules.minMarginBps / 100).toFixed(1)}%`);
    }
  }
  return { ok: problems.length === 0, problems, marginBps, profit };
}

// ───────────────────────── Order-level checks ─────────────────────────

export interface ShipToLike {
  fullName?: string;
  line1?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  region?: string;
}

/** Hard requirements before any supplier sees the address. `postalProblem` comes from lib/shipping/address. */
export function addressProblems(a: ShipToLike, postalProblem: string | null, opts: { phoneRequired: boolean }): string[] {
  const p: string[] = [];
  const blank = (v?: string) => !v || !v.trim();
  if (blank(a.fullName) || (a.fullName ?? "").trim().length < 2) p.push("recipient name missing");
  if (blank(a.line1) || (a.line1 ?? "").trim().length < 3) p.push("street address missing");
  if (blank(a.city)) p.push("city missing");
  if (blank(a.postalCode)) p.push("postal code missing");
  if (!a.country || !/^[A-Z]{2}$/.test(a.country)) p.push("country invalid");
  if (postalProblem) p.push(postalProblem.toLowerCase());
  if (opts.phoneRequired && (blank(a.phone) || (a.phone ?? "").replace(/\D/g, "").length < 6)) p.push("phone number required by the supplier");
  return p;
}

export function countryAllowed(country: string, rules: PurchasingRules): boolean {
  return rules.allowedCountries.length === 0 || rules.allowedCountries.includes(country);
}

/** Exponential backoff for job retries: 1 min, 2, 4, 8 … capped at 6 h. */
export function retryDelayMs(attempt: number): number {
  return Math.min(6 * 3600_000, 60_000 * 2 ** Math.max(0, attempt - 1));
}

/** Revenue allocated to a subset of order lines: share of (total − tax), by line value. */
export function allocateRevenue(o: { total: number; taxTotal: number; subtotal: number }, linesTotal: number): number {
  if (o.subtotal <= 0) return 0;
  const net = o.total - o.taxTotal;
  return Math.floor((net * linesTotal) / o.subtotal);
}


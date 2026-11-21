/**
 * Profit calculation in the store's base currency. Pure (unit tested).
 * Revenue excludes collected tax. Costs are FINAL when the supplier order cost was recorded and the
 * provider fee is known; otherwise ESTIMATED from the supplier mapping cost. Unknown fees are never invented:
 * they count as 0 and the order is flagged as estimated.
 */
import { convertMinor } from "../fx";
import type { CurrencyCode } from "../money";

export const REVENUE_STATUSES = new Set([
  "paid", "processing", "submitted_to_supplier", "supplier_accepted", "shipped", "delivered", "refund_requested", "refunded",
]);

export interface ProfitOrderInput {
  id: string;
  status: string;
  currency: CurrencyCode;
  total: number;
  taxTotal: number;
  /** Order currency → base currency rate snapshot taken at purchase; null = use `fallbackRates`. */
  fxRateToBase: string | null;
  /** Final supplier cost (sum of supplier_orders.cost_total), in its currency; null = not recorded yet. */
  supplierCostFinal: { amount: number; currency: CurrencyCode } | null;
  /** Estimated supplier cost from mappings. */
  supplierCostEstimated: { amount: number; currency: CurrencyCode } | null;
  refunded: number; // order currency
  fee: number | null; // order currency; null = provider did not report
}

export interface ProfitExpenseInput {
  amount: number;
  currency: CurrencyCode;
}

export interface ProfitSummary {
  baseCurrency: CurrencyCode;
  orders: number;
  revenue: number; // net of tax
  tax: number;
  costOfGoods: number;
  fees: number;
  refunds: number;
  expenses: number;
  grossProfit: number; // revenue − refunds − cost of goods − fees
  netProfit: number; // gross − expenses
  estimatedOrders: number; // orders whose numbers are not final
  missingCost: number; // orders with no cost at all (unmapped)
  missingRate: boolean; // a conversion rate was unavailable (amount excluded)
}

/** rates: currency → rate to base (1 unit of currency = rate base). */
export function computeProfit(
  orders: readonly ProfitOrderInput[],
  expenses: readonly ProfitExpenseInput[],
  baseCurrency: CurrencyCode,
  fallbackRates: Partial<Record<CurrencyCode, string>>,
): ProfitSummary {
  const s: ProfitSummary = {
    baseCurrency, orders: 0, revenue: 0, tax: 0, costOfGoods: 0, fees: 0, refunds: 0, expenses: 0,
    grossProfit: 0, netProfit: 0, estimatedOrders: 0, missingCost: 0, missingRate: false,
  };
  const toBase = (amount: number, currency: CurrencyCode, snapshot: string | null): number | null => {
    if (currency === baseCurrency) return amount;
    const rate = snapshot ?? fallbackRates[currency] ?? null;
    return rate ? convertMinor(amount, currency, baseCurrency, rate) : null;
  };

  for (const o of orders) {
    if (!REVENUE_STATUSES.has(o.status)) continue;
    // A refund gives back tax too: split it pro rata so tax is not subtracted twice (revenue is already net of tax).
    const refundTax = o.total > 0 ? Math.round((o.refunded * o.taxTotal) / o.total) : 0;
    const revenue = toBase(o.total - o.taxTotal, o.currency, o.fxRateToBase);
    const tax = toBase(o.taxTotal - refundTax, o.currency, o.fxRateToBase);
    const refunds = toBase(o.refunded - refundTax, o.currency, o.fxRateToBase);
    const fee = o.fee === null ? 0 : toBase(o.fee, o.currency, o.fxRateToBase);
    // Refunded before reaching a supplier: no goods were bought, so no cost (never an invented one).
    const neverFulfilled = o.status === "refunded" && o.supplierCostFinal === null;
    const costSrc = neverFulfilled ? null : (o.supplierCostFinal ?? o.supplierCostEstimated);
    const cost = costSrc ? toBase(costSrc.amount, costSrc.currency, costSrc.currency === o.currency ? o.fxRateToBase : null) : 0;
    if (revenue === null || tax === null || refunds === null || fee === null || cost === null) {
      s.missingRate = true;
      continue;
    }
    s.orders++;
    s.revenue += revenue;
    s.tax += tax;
    s.refunds += refunds;
    s.fees += fee;
    s.costOfGoods += cost;
    if (!costSrc && !neverFulfilled) s.missingCost++;
    const final = (o.supplierCostFinal !== null || neverFulfilled) && o.fee !== null && (o.status === "delivered" || o.status === "refunded");
    if (!final) s.estimatedOrders++;
  }
  for (const e of expenses) {
    const v = toBase(e.amount, e.currency, null);
    if (v === null) s.missingRate = true;
    else s.expenses += v;
  }
  s.grossProfit = s.revenue - s.refunds - s.costOfGoods - s.fees;
  s.netProfit = s.grossProfit - s.expenses;
  return s;
}

/** Margin in basis points of price over cost (both same currency), or null if price is 0. */
export function marginBps(price: number, cost: number): number | null {
  if (price <= 0) return null;
  return Math.round(((price - cost) * 10000) / price);
}

export interface OrderBreakdownInput {
  status: string;
  currency: CurrencyCode;
  subtotal: number; // gross product revenue (before discount; incl. VAT for EU inclusive pricing)
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  refunded: number; // settled refunds (succeeded + manual), order currency
  fee: number | null; // actual provider fee in order currency; null = not reported
  supplierCost: { amount: number; currency: CurrencyCode; final: boolean } | null;
}

export interface OrderBreakdown {
  netRevenue: number; // total − tax − refunds (net of their tax share), order currency
  refundedNet: number;
  taxKept: number;
  /** null when a cost is in another currency (no invented conversion) or missing for a fulfilled order. */
  supplierCost: number | null;
  costFinal: boolean;
  fee: number | null;
  /** netRevenue − supplier cost − fee; null when the cost is unknown. ESTIMATED unless costFinal and fee are known. */
  estimatedProfit: number | null;
}

/** One order's money, in the order's own currency. Pure (unit tested). */
export function orderBreakdown(o: OrderBreakdownInput): OrderBreakdown {
  const refundTax = o.total > 0 ? Math.round((o.refunded * o.tax) / o.total) : 0;
  const refundedNet = o.refunded - refundTax;
  const netRevenue = o.total - o.tax - refundedNet;
  const neverFulfilled = o.status === "refunded" && !(o.supplierCost?.final);
  const cost = neverFulfilled ? 0 : o.supplierCost && o.supplierCost.currency === o.currency ? o.supplierCost.amount : null;
  return {
    netRevenue, refundedNet, taxKept: o.tax - refundTax,
    supplierCost: cost, costFinal: neverFulfilled || !!o.supplierCost?.final, fee: o.fee,
    estimatedProfit: cost === null ? null : netRevenue - cost - (o.fee ?? 0),
  };
}

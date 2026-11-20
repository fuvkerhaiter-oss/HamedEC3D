/**
 * Server-side cart pricing. Clients send only variant ids and quantities;
 * prices, stock and totals always come from the catalog on the server.
 */
import { add, minMoney, money, multiply, percentOf, subtract, sum, zero, type CurrencyCode, type Money } from "../money";
import { priceIn, type CatalogReader } from "../catalog/types";
import type { TaxMode } from "../markets";

export const MAX_LINE_QUANTITY = 99;
export const MAX_CART_LINES = 100;

export interface CartLineInput {
  variantId: string;
  quantity: number;
}

export type Discount =
  | { code: string; kind: "percent"; basisPoints: number; minSubtotal?: Money }
  | { code: string; kind: "fixed"; amount: Money; minSubtotal?: Money };

export interface ShippingQuote {
  methodId: string;
  label: string;
  amount: Money;
}

export interface PricedLine {
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantName: string;
  /** Product main image (same source as catalog/3D store); null = placeholder. */
  imageUrl: string | null;
  unitPrice: Money;
  quantity: number;
  lineTotal: Money;
}

export interface CartIssue {
  variantId: string;
  code: "not_found" | "not_published" | "out_of_stock" | "insufficient_stock" | "invalid_quantity" | "currency_mismatch";
  message: string;
}

export interface PricedCart {
  currency: CurrencyCode;
  lines: PricedLine[];
  issues: CartIssue[];
  subtotal: Money;
  discount: Money;
  shipping: Money;
  tax: Money;
  total: Money;
  taxMode: TaxMode;
  /** True only when there are lines and no blocking issues. */
  purchasable: boolean;
}

export interface PriceCartOptions {
  currency: CurrencyCode;
  discount?: Discount | null;
  shipping?: ShippingQuote | null;
  /** Tax rate in basis points for the destination, from the `tax_rates` table. Default 0. */
  taxBasisPoints?: number;
  /** inclusive (EU): prices already contain tax; tax is reported, not added. exclusive (US): tax is added. */
  taxMode?: TaxMode;
}

export async function priceCart(
  input: readonly CartLineInput[],
  catalog: CatalogReader,
  opts: PriceCartOptions,
): Promise<PricedCart> {
  const { currency } = opts;
  const issues: CartIssue[] = [];
  const lines: PricedLine[] = [];

  // Merge duplicate variant lines so stock checks see the real total quantity.
  const merged = new Map<string, number>();
  for (const line of input.slice(0, MAX_CART_LINES)) {
    merged.set(line.variantId, (merged.get(line.variantId) ?? 0) + line.quantity);
  }

  for (const [variantId, quantity] of merged) {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
      issues.push({ variantId, code: "invalid_quantity", message: `Quantity must be 1–${MAX_LINE_QUANTITY}` });
      continue;
    }
    const found = await catalog.getVariant(variantId);
    if (!found) {
      issues.push({ variantId, code: "not_found", message: "Product no longer available" });
      continue;
    }
    const { product, variant } = found;
    if (product.status !== "published") {
      issues.push({ variantId, code: "not_published", message: "Product is not for sale" });
      continue;
    }
    const unitPrice = priceIn(variant, currency);
    if (!unitPrice) {
      issues.push({ variantId, code: "currency_mismatch", message: `Not sold in ${currency}` });
      continue;
    }
    if (variant.stockQuantity <= 0) {
      issues.push({ variantId, code: "out_of_stock", message: "Out of stock" });
      continue;
    }
    if (quantity > variant.stockQuantity) {
      issues.push({ variantId, code: "insufficient_stock", message: `Only ${variant.stockQuantity} available` });
      continue;
    }
    lines.push({
      variantId,
      productId: product.id,
      sku: variant.sku,
      productName: product.name,
      variantName: variant.name,
      imageUrl: product.imageUrl,
      unitPrice,
      quantity,
      lineTotal: multiply(unitPrice, quantity),
    });
  }

  const subtotal = sum(lines.map((l) => l.lineTotal), currency);
  const discount = computeDiscount(subtotal, opts.discount ?? null);
  const shipping = lines.length && opts.shipping ? opts.shipping.amount : zero(currency);
  if (shipping.currency !== currency) throw new Error("Shipping quote currency mismatch");
  const taxable = subtract(subtotal, discount);
  const taxMode = opts.taxMode ?? "exclusive";
  const bps = opts.taxBasisPoints ?? 0;
  let tax: Money;
  let total: Money;
  if (taxMode === "inclusive") {
    // Tax contained in the gross (goods + shipping): gross * r / (1 + r), round half up.
    const gross = add(taxable, shipping);
    tax = includedTax(gross, bps);
    total = gross;
  } else {
    // US: shipping taxability varies by state; goods-only until confirmed per state.
    tax = percentOf(taxable, bps);
    total = add(add(taxable, shipping), tax);
  }

  return {
    currency,
    lines,
    issues,
    subtotal,
    discount,
    shipping,
    tax,
    total,
    taxMode,
    purchasable: lines.length > 0 && issues.length === 0,
  };
}

function includedTax(gross: Money, basisPoints: number): Money {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) throw new Error("Invalid tax rate");
  if (basisPoints === 0 || gross.amount <= 0) return zero(gross.currency);
  const num = gross.amount * basisPoints;
  const den = 10000 + basisPoints;
  return money(Math.floor((2 * num + den) / (2 * den)), gross.currency);
}

function computeDiscount(subtotal: Money, discount: Discount | null): Money {
  const none = zero(subtotal.currency);
  if (!discount || subtotal.amount === 0) return none;
  if (discount.minSubtotal && subtotal.amount < discount.minSubtotal.amount) return none;
  const raw = discount.kind === "percent" ? percentOf(subtotal, discount.basisPoints) : discount.amount;
  if (raw.currency !== subtotal.currency || raw.amount <= 0) return none;
  // Never discount more than the subtotal.
  return minMoney(raw, subtotal);
}

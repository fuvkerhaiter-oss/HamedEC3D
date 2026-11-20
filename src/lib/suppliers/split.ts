/**
 * Split an order into one supplier order per supplier, using the supplier ↔ variant mapping
 * (`supplier_products`, primary mapping preferred). Pure (unit tested).
 */
import type { CurrencyCode } from "../money";

export interface SplitOrderLine {
  orderItemId: string;
  variantId: string | null;
  sku: string;
  quantity: number;
}

export interface SupplierMapping {
  variantId: string;
  supplierId: string;
  supplierSku: string;
  costAmount: number;
  costCurrency: CurrencyCode;
  isPrimary: boolean;
}

export interface SupplierGroupLine {
  orderItemId: string;
  supplierSku: string;
  quantity: number;
  unitCost: number;
  costCurrency: CurrencyCode;
}

export interface SupplierGroup {
  supplierId: string;
  lines: SupplierGroupLine[];
  /** Estimated cost from the mapping; null when lines are costed in different currencies. */
  costTotal: { amount: number; currency: CurrencyCode } | null;
}

export interface SplitResult {
  groups: SupplierGroup[];
  /** Lines with no supplier mapping (deleted variant or not yet mapped) — need manual handling. */
  unassigned: SplitOrderLine[];
}

export function splitOrderBySupplier(lines: readonly SplitOrderLine[], mappings: readonly SupplierMapping[]): SplitResult {
  const byVariant = new Map<string, SupplierMapping>();
  for (const m of mappings) {
    const cur = byVariant.get(m.variantId);
    if (!cur || (m.isPrimary && !cur.isPrimary)) byVariant.set(m.variantId, m);
  }
  const groups = new Map<string, SupplierGroup>();
  const unassigned: SplitOrderLine[] = [];
  for (const line of lines) {
    const m = line.variantId ? byVariant.get(line.variantId) : undefined;
    if (!m) {
      unassigned.push(line);
      continue;
    }
    const g = groups.get(m.supplierId) ?? { supplierId: m.supplierId, lines: [], costTotal: null };
    g.lines.push({ orderItemId: line.orderItemId, supplierSku: m.supplierSku, quantity: line.quantity, unitCost: m.costAmount, costCurrency: m.costCurrency });
    groups.set(m.supplierId, g);
  }
  for (const g of groups.values()) {
    const currencies = new Set(g.lines.map((l) => l.costCurrency));
    if (currencies.size === 1) {
      const amount = g.lines.reduce((s, l) => s + l.unitCost * l.quantity, 0);
      if (!Number.isSafeInteger(amount)) throw new Error("Supplier cost overflow");
      g.costTotal = { amount, currency: g.lines[0]!.costCurrency };
    }
  }
  return { groups: [...groups.values()].sort((a, b) => a.supplierId.localeCompare(b.supplierId)), unassigned };
}

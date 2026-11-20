import { csvResponse, toCsv } from "@/lib/csv";
import { logActivity } from "@/lib/admin/audit";
import { resolveRange } from "@/lib/admin/date-range";
import { clientIp, requireApi } from "@/lib/admin/guard";
import type { Permission } from "@/lib/admin/permissions";
import { listInventory } from "@/lib/admin/services/catalog-admin";
import { dailySeries, salesByCountry, topProducts } from "@/lib/admin/services/finance";
import { maskEmail } from "@/lib/admin/services/people";
import { exportProductsCsv } from "@/lib/admin/services/products";
import { toDecimalString, type CurrencyCode } from "@/lib/money";

export const dynamic = "force-dynamic";

const PERM: Record<string, Permission> = {
  products: "products.import",
  orders: "orders.export",
  inventory: "inventory.view",
  customers: "customers.view",
  sales: "analytics.view",
  "top-products": "analytics.view",
  countries: "analytics.view",
};

const dec = (amount: number | null, currency: string | null) => (amount === null || !currency ? "" : toDecimalString({ amount, currency: currency as CurrencyCode }));

/** Authenticated, permission-checked CSV exports. Every export is recorded in the activity log. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const perm = PERM[kind];
  if (!perm) return new Response("Unknown export", { status: 404 });
  const auth = await requireApi(perm);
  if (auth instanceof Response) return auth;
  const { sql, session } = auth;
  const url = new URL(req.url);
  const range = resolveRange({ range: url.searchParams.get("range") ?? undefined, from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined });
  const stamp = new Date().toISOString().slice(0, 10);
  let csv: string;

  if (kind === "products") csv = await exportProductsCsv(sql);
  else if (kind === "orders") {
    const pii = session.permissions.has("customers.pii");
    const rows = await sql<{ order_number: number; created_at: Date; status: string; email: string; currency: string; subtotal: number; discount_total: number; shipping_total: number; tax_total: number; total: number; ship_country: string; discount_code: string | null; is_test: boolean; items: number }[]>`
      select o.order_number, o.created_at, o.status::text, o.email, o.currency, o.subtotal, o.discount_total, o.shipping_total, o.tax_total, o.total,
        o.ship_country, o.discount_code, o.is_test, (select coalesce(sum(quantity), 0)::int from public.order_items i where i.order_id = o.id) as items
      from public.orders o where o.created_at >= ${range.from} and o.created_at < ${range.to} order by o.created_at`;
    csv = toCsv(
      ["order_number", "created_at", "status", "email", "currency", "subtotal", "discount", "shipping", "tax", "total", "items", "country", "discount_code", "test"],
      rows.map((r) => [r.order_number, r.created_at.toISOString(), r.status, pii ? r.email : maskEmail(r.email), r.currency, dec(r.subtotal, r.currency), dec(r.discount_total, r.currency),
        dec(r.shipping_total, r.currency), dec(r.tax_total, r.currency), dec(r.total, r.currency), r.items, r.ship_country, r.discount_code, r.is_test]),
    );
  } else if (kind === "inventory") {
    const { rows } = await listInventory(sql, { pageSize: 200, page: 1 });
    csv = toCsv(["sku", "product", "variant", "on_hand", "reserved", "available", "incoming", "supplier_reported", "low_stock_threshold"],
      rows.map((r) => [r.sku, r.product_name, r.variant_name, r.quantity, r.reserved, r.available, r.incoming, r.supplier_reported, r.threshold]));
  } else if (kind === "customers") {
    const pii = session.permissions.has("customers.pii");
    const rows = await sql<{ email: string; orders: number; first: Date; last: Date }[]>`
      select lower(email) as email, count(*)::int as orders, min(created_at) as first, max(created_at) as last from public.orders group by 1 order by 4 desc`;
    csv = toCsv(["email", "orders", "first_order", "last_order"], rows.map((r) => [pii ? r.email : maskEmail(r.email), r.orders, r.first.toISOString(), r.last.toISOString()]));
  } else if (kind === "sales") {
    const series = await dailySeries(sql, range);
    csv = toCsv(["day", "paid_orders", "revenue_eur", "revenue_usd"], series.map((d) => [d.day, d.orders, dec(d.revenue.EUR ?? 0, "EUR"), dec(d.revenue.USD ?? 0, "USD")]));
  } else if (kind === "top-products") {
    const rows = await topProducts(sql, range, 100);
    csv = toCsv(["product", "currency", "units", "revenue"], rows.map((r) => [r.product_name, r.currency, r.units, dec(r.revenue, r.currency)]));
  } else {
    const rows = await salesByCountry(sql, range);
    csv = toCsv(["country", "currency", "orders", "revenue"], rows.map((r) => [r.country, r.currency, r.orders, dec(r.revenue, r.currency)]));
  }
  await logActivity(sql, { id: session.user.id, email: session.user.email, ip: await clientIp() }, { action: "export", entity: kind, summary: `Exported ${kind} CSV` });
  return csvResponse(`megamarket-${kind}-${stamp}.csv`, csv);
}

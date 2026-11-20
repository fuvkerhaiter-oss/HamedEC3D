/** Discount codes: admin CRUD + server-side validation used by cart pricing and order creation. */
import { normalizeCode, validateCoupon, type CouponContext, type CouponRecord, type CouponResult } from "../../coupons/validate";
import type { Db } from "../../db/client";
import type { CurrencyCode } from "../../money";
import { logActivity, type Actor } from "../audit";

interface DiscountRow {
  id: string;
  code: string;
  name: string;
  kind: "percent" | "fixed";
  basis_points: number | null;
  amount: number | null;
  currency: CurrencyCode | null;
  min_subtotal: number | null;
  starts_at: Date | null;
  ends_at: Date | null;
  max_redemptions: number | null;
  per_customer_limit: number | null;
  is_active: boolean;
  applies_to: "all" | "category" | "product";
  target_ids: string[];
  created_at: Date;
  redemption_count: number;
}

export async function loadCouponForCode(
  db: Db, code: string, ctx: CouponContext, customerEmail?: string | null,
): Promise<{ record: CouponRecord | null; result: CouponResult }> {
  const [row] = await db<DiscountRow[]>`
    select d.*, (select count(*)::int from public.discount_redemptions r where r.discount_id = d.id) as redemption_count
      from public.discounts d where lower(d.code) = lower(${normalizeCode(code)})`;
  let customerRedemptions = 0;
  if (row && row.per_customer_limit !== null && customerEmail) {
    const [c] = await db<{ n: number }[]>`
      select count(*)::int as n from public.discount_redemptions r join public.orders o on o.id = r.order_id
       where r.discount_id = ${row.id} and lower(o.email) = lower(${customerEmail}) and o.status not in ('cancelled','failed')`;
    customerRedemptions = c?.n ?? 0;
  }
  const record: CouponRecord | null = row
    ? {
        id: row.id, code: row.code, kind: row.kind, basisPoints: row.basis_points, amount: row.amount, currency: row.currency,
        minSubtotal: row.min_subtotal, startsAt: row.starts_at, endsAt: row.ends_at, maxRedemptions: row.max_redemptions,
        redemptionCount: row.redemption_count, perCustomerLimit: row.per_customer_limit, customerRedemptions,
        isActive: row.is_active, appliesTo: row.applies_to, targetIds: row.target_ids,
      }
    : null;
  return { record, result: validateCoupon(record, ctx) };
}

export async function listCoupons(db: Db) {
  return db<DiscountRow[]>`
    select d.*, (select count(*)::int from public.discount_redemptions r where r.discount_id = d.id) as redemption_count
      from public.discounts d order by d.created_at desc`;
}

export interface CouponInput {
  id?: string;
  code: string;
  name: string;
  kind: "percent" | "fixed";
  basisPoints: number | null;
  amount: number | null;
  currency: CurrencyCode | null;
  minSubtotal: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  perCustomerLimit: number | null;
  isActive: boolean;
  appliesTo: "all" | "category" | "product";
  targetIds: string[];
}

export async function saveCoupon(db: Db, actor: Actor, c: CouponInput): Promise<string> {
  const code = normalizeCode(c.code);
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw new Error("Code must be 3–40 letters, digits, - or _");
  const vals = {
    code, name: c.name, kind: c.kind,
    basis_points: c.kind === "percent" ? c.basisPoints : null,
    amount: c.kind === "fixed" ? c.amount : null,
    currency: c.currency, min_subtotal: c.minSubtotal, starts_at: c.startsAt, ends_at: c.endsAt,
    max_redemptions: c.maxRedemptions, per_customer_limit: c.perCustomerLimit, is_active: c.isActive,
    applies_to: c.appliesTo, target_ids: c.appliesTo === "all" ? [] : c.targetIds,
  };
  if (c.id) {
    const [before] = await db`select * from public.discounts where id = ${c.id}`;
    await db`update public.discounts set ${db(vals)} where id = ${c.id}`;
    await logActivity(db, actor, { action: "discount.update", entity: "discount", entityId: c.id, summary: `Updated code ${code}`, before, after: vals });
    return c.id;
  }
  const [row] = await db<{ id: string }[]>`insert into public.discounts ${db({ ...vals, created_by: actor.id })} returning id`;
  await logActivity(db, actor, { action: "discount.create", entity: "discount", entityId: row!.id, summary: `Created code ${code}`, after: vals });
  return row!.id;
}

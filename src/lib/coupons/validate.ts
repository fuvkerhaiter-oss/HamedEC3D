/**
 * Server-side coupon validation. Pure (unit tested); the DB layer loads the record + usage counts.
 * Returns a pricing `Discount` (fixed amount for targeted coupons) or the reason it doesn't apply.
 */
import type { Discount } from "../cart/pricing";
import { money, percentOf, type CurrencyCode } from "../money";

export interface CouponRecord {
  id: string;
  code: string;
  kind: "percent" | "fixed";
  basisPoints: number | null;
  amount: number | null;
  currency: CurrencyCode | null;
  minSubtotal: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  perCustomerLimit: number | null;
  customerRedemptions: number;
  isActive: boolean;
  appliesTo: "all" | "category" | "product";
  targetIds: string[];
}

export interface CouponContext {
  currency: CurrencyCode;
  now: Date;
  lines: { productId: string; categoryId: string; lineTotal: number }[];
}

export type CouponResult = { ok: true; discount: Discount; eligibleSubtotal: number } | { ok: false; reason: string };

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function validateCoupon(rec: CouponRecord | null, ctx: CouponContext): CouponResult {
  if (!rec || !rec.isActive) return { ok: false, reason: "This code is not valid." };
  if (rec.startsAt && ctx.now < rec.startsAt) return { ok: false, reason: "This code is not active yet." };
  if (rec.endsAt && ctx.now >= rec.endsAt) return { ok: false, reason: "This code has expired." };
  if (rec.maxRedemptions !== null && rec.redemptionCount >= rec.maxRedemptions) return { ok: false, reason: "This code has been fully redeemed." };
  if (rec.perCustomerLimit !== null && rec.customerRedemptions >= rec.perCustomerLimit) return { ok: false, reason: "You have already used this code." };
  if (rec.currency && rec.currency !== ctx.currency) return { ok: false, reason: `This code is only valid for ${rec.currency} orders.` };

  const eligible = ctx.lines.filter((l) =>
    rec.appliesTo === "all" ? true : rec.appliesTo === "product" ? rec.targetIds.includes(l.productId) : rec.targetIds.includes(l.categoryId),
  );
  const eligibleSubtotal = eligible.reduce((s, l) => s + l.lineTotal, 0);
  const subtotal = ctx.lines.reduce((s, l) => s + l.lineTotal, 0);
  if (eligibleSubtotal <= 0) return { ok: false, reason: "This code doesn't apply to the items in your cart." };
  if (rec.minSubtotal !== null && subtotal < rec.minSubtotal) return { ok: false, reason: "Your order doesn't reach this code's minimum." };

  const code = normalizeCode(rec.code);
  if (rec.kind === "percent") {
    if (!rec.basisPoints) return { ok: false, reason: "This code is misconfigured." };
    if (rec.appliesTo === "all") return { ok: true, discount: { code, kind: "percent", basisPoints: rec.basisPoints }, eligibleSubtotal };
    const amount = percentOf(money(eligibleSubtotal, ctx.currency), rec.basisPoints);
    return { ok: true, discount: { code, kind: "fixed", amount }, eligibleSubtotal };
  }
  if (!rec.amount || !rec.currency) return { ok: false, reason: "This code is misconfigured." };
  return { ok: true, discount: { code, kind: "fixed", amount: money(Math.min(rec.amount, eligibleSubtotal), ctx.currency) }, eligibleSubtotal };
}

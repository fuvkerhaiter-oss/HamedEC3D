/**
 * Shop rental plans and the launch promotion. Pure data + math (no DB), shared by the rental page, the 3D store's
 * "Rent this shop" panel, the checkout API (which re-computes every amount on the server) and tests.
 *
 * Presentation rules (EU Omnibus Directive art. 6a / Italian Consumer Code art. 17-bis, US FTC 16 CFR 233):
 * - The plans have never been sold at the "regular" price, so the UI must NOT show it as a struck-through former
 *   price or a "−x%" discount. It is shown only as the announced standard price for bookings paid after
 *   LAUNCH_PROMO.endsAt (an introductory price, not a price reduction). quotePlan() switches to it automatically.
 * - discountPercent stays available for internal use (admin, tests), rounded DOWN; do not render it to customers
 *   until the standard price has actually been charged for at least 30 days.
 * - savingVsMonthly compares two prices that are both on sale now, so it may be shown.
 * - A tenant keeps the price they paid for the whole term they bought. Have a lawyer confirm this wording.
 */
import type { CurrencyCode } from "../money";

export type RentalPlanId = "monthly" | "quarterly" | "yearly";
export const RENTAL_CURRENCIES = ["USD", "EUR"] as const satisfies readonly CurrencyCode[];
export type RentalCurrency = (typeof RENTAL_CURRENCIES)[number];

export interface RentalPlan {
  id: RentalPlanId;
  months: number;
  name: string;
  tagline: string;
  /** Launch-offer price for the whole term, minor units. */
  promo: Record<RentalCurrency, number>;
  /** Regular price for the whole term (charged after the launch offer ends), minor units. */
  regular: Record<RentalCurrency, number>;
  /** Highlighted as the best value. */
  featured?: boolean;
}

const same = (n: number): Record<RentalCurrency, number> => ({ USD: n, EUR: n });

export const RENTAL_PLANS: readonly RentalPlan[] = [
  { id: "monthly", months: 1, name: "Monthly", tagline: "Try the 3D store with no long commitment", promo: same(2000), regular: same(2900) },
  { id: "quarterly", months: 3, name: "Quarterly", tagline: "One season to launch and grow your brand", promo: same(5400), regular: same(7900) },
  { id: "yearly", months: 12, name: "Yearly", tagline: "Your own shop all year at the lowest price", promo: same(15000), regular: same(29000), featured: true },
];

export const LAUNCH_PROMO = {
  name: "Launch offer",
  /** Last moment the launch price is charged (UTC). After it, every plan costs its regular price. */
  endsAt: "2027-03-31T23:59:59Z",
} as const;

export function isRentalPlanId(v: string): v is RentalPlanId {
  return RENTAL_PLANS.some((p) => p.id === v);
}

export function isRentalCurrency(v: string): v is RentalCurrency {
  return (RENTAL_CURRENCIES as readonly string[]).includes(v);
}

export function rentalPlan(id: RentalPlanId): RentalPlan {
  const p = RENTAL_PLANS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown rental plan ${id}`);
  return p;
}

export function promoActive(now: Date = new Date()): boolean {
  return now.getTime() <= Date.parse(LAUNCH_PROMO.endsAt);
}

/** Saving in whole percent, rounded down (never overstated). */
export function discountPercent(regular: number, price: number): number {
  if (regular <= 0 || price >= regular) return 0;
  return Math.floor(((regular - price) * 100) / regular);
}

export interface RentalQuote {
  plan: RentalPlanId;
  months: number;
  currency: RentalCurrency;
  /** What is charged now for the whole term, minor units. */
  amount: number;
  /** The plan's regular price for the whole term, minor units (shown struck through while the offer runs). */
  regularAmount: number;
  promo: boolean;
  /** 0 when no offer applies. */
  discountPercent: number;
  /** Effective monthly price, minor units, rounded to the nearest unit (display only). */
  perMonth: number;
  /** Saving against paying the same plan's monthly price month by month, in whole percent (rounded down). */
  savingVsMonthly: number;
  promoEndsAt: string | null;
}

export function quotePlan(planId: RentalPlanId, currency: RentalCurrency, now: Date = new Date()): RentalQuote {
  const plan = rentalPlan(planId);
  const on = promoActive(now);
  const amount = on ? plan.promo[currency] : plan.regular[currency];
  const regularAmount = plan.regular[currency];
  const monthly = rentalPlan("monthly");
  const monthlyRate = on ? monthly.promo[currency] : monthly.regular[currency];
  return {
    plan: plan.id,
    months: plan.months,
    currency,
    amount,
    regularAmount,
    promo: on && amount < regularAmount,
    discountPercent: on ? discountPercent(regularAmount, amount) : 0,
    perMonth: Math.round(amount / plan.months),
    savingVsMonthly: discountPercent(monthlyRate * plan.months, amount),
    promoEndsAt: on ? LAUNCH_PROMO.endsAt : null,
  };
}

export function quoteAll(currency: RentalCurrency, now: Date = new Date()): RentalQuote[] {
  return RENTAL_PLANS.map((p) => quotePlan(p.id, currency, now));
}

/** start + n calendar months (UTC); the day is clamped to the last day of a shorter month (31 Jan + 1 → 28/29 Feb). */
export function addMonths(start: Date, months: number): Date {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = new Date(start);
  d.setUTCFullYear(y, m, Math.min(start.getUTCDate(), lastDay));
  return d;
}

/**
 * Which rental shops are free, held (someone is on the payment page) or rented. Pure: the DB layer passes the
 * leases in. Shop ids are the 3D store's units (store3d/env/shops.ts SHOP_UNITS).
 */
import { SHOP_UNITS } from "@/features/store3d/env/shops";

export type LeaseStatus = "pending_payment" | "active" | "cancelled" | "expired_unpaid" | "refunded" | "payment_review";

/** How long a shop stays reserved for someone on the payment page (Stripe needs a checkout to live 30+ min). */
export const RENTAL_HOLD_MINUTES = 35;
/** Payment page lifetime: ends before the hold, so nobody can pay for a shop that was released. */
export const RENTAL_SESSION_SECONDS = 32 * 60;

export interface LeaseLite {
  id: string;
  shopId: string;
  status: LeaseStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  holdExpiresAt: Date;
  /** Shown on the 3D fascia once an admin approved it. */
  displayName: string | null;
  displayApproved: boolean;
}

export type ShopState =
  | { shopId: string; state: "available" }
  | { shopId: string; state: "held"; until: Date }
  | {
      shopId: string;
      state: "rented";
      /** End of the current tenant's paid time, including renewals already paid. */
      until: Date;
      leaseId: string;
      /** Brand name for the 3D sign; null until approved. */
      brand: string | null;
    };

export function isShopId(v: string): boolean {
  return SHOP_UNITS.some((u) => u.id === v);
}

const covers = (l: LeaseLite, now: Date) => l.status === "active" && !!l.startsAt && !!l.endsAt && l.startsAt <= now && now < l.endsAt;

/** Paid leases of a shop that end after `now` (current + already paid renewals), ordered by start. */
export function paidAhead(shopId: string, leases: readonly LeaseLite[], now: Date): LeaseLite[] {
  return leases
    .filter((l) => l.shopId === shopId && l.status === "active" && l.endsAt && l.endsAt > now)
    .sort((a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0));
}

export function shopState(shopId: string, leases: readonly LeaseLite[], now: Date = new Date()): ShopState {
  const ahead = paidAhead(shopId, leases, now);
  const current = ahead.find((l) => covers(l, now));
  if (current) {
    const until = ahead.reduce((t, l) => (l.endsAt && l.endsAt > t ? l.endsAt : t), current.endsAt!);
    const brand = current.displayApproved && current.displayName ? current.displayName : null;
    return { shopId, state: "rented", until, leaseId: current.id, brand };
  }
  const hold = leases
    .filter((l) => l.shopId === shopId && l.status === "pending_payment" && l.holdExpiresAt > now)
    .sort((a, b) => b.holdExpiresAt.getTime() - a.holdExpiresAt.getTime())[0];
  if (hold) return { shopId, state: "held", until: hold.holdExpiresAt };
  return { shopId, state: "available" };
}

export function allShopStates(leases: readonly LeaseLite[], now: Date = new Date()): ShopState[] {
  return SHOP_UNITS.map((u) => shopState(u.id, leases, now));
}

/**
 * When a paid lease starts. New tenant: now. Renewal: right after the tenant's last paid day (or now if that
 * already passed), so renewing early never loses days.
 */
export function leaseStart(shopId: string, leases: readonly LeaseLite[], now: Date, renewing: boolean): Date {
  if (!renewing) return now;
  const end = paidAhead(shopId, leases, now).reduce<Date | null>((t, l) => (l.endsAt && (!t || l.endsAt > t) ? l.endsAt : t), null);
  return end && end > now ? end : now;
}

/**
 * Whether a payment for `lease` can be turned into a paid lease. A new tenant needs the shop to be free of other
 * paid tenants right now; a renewal only needs the tenant's own chain (checked by the caller).
 */
export function canActivate(lease: LeaseLite, leases: readonly LeaseLite[], now: Date, renewing: boolean): boolean {
  if (renewing) return true;
  return !paidAhead(lease.shopId, leases.filter((l) => l.id !== lease.id), now).length;
}

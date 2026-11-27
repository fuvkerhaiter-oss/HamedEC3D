/**
 * Shop rentals, database side. Flow: booking form → lease row `pending_payment` that holds the shop for
 * RENTAL_HOLD_MINUTES → payment page at the provider → verified webhook (lib/rentals/webhook.ts) → `active` with
 * start/end dates. Every amount comes from lib/rentals/pricing.ts on the server, never from the client.
 * Bookings and activations of one shop are serialised with a transaction-scoped advisory lock.
 */
import { randomInt } from "node:crypto";
import { inTx, type Db } from "../db/client";
import { leaseUrl } from "../checkout/order-link";
import { publicSiteUrl } from "../email/outbox";
import { getEmailProvider } from "../email/provider";
import { button, detailRows, note, renderEmail, steps } from "../email/layout";
import { notify } from "../admin/services/notifications";
import { formatMoney, type CurrencyCode } from "../money";
import { getPaymentProvider } from "../payments/registry";
import type { PaymentProvider } from "../payments/types";
import { SHOP_UNITS } from "@/features/store3d/env/shops";
import { allShopStates, canActivate, leaseStart, RENTAL_HOLD_MINUTES, RENTAL_SESSION_SECONDS, shopState, type LeaseLite, type LeaseStatus, type ShopState } from "./availability";
import { addMonths, LAUNCH_PROMO, quotePlan, rentalPlan, type RentalCurrency, type RentalPlanId } from "./pricing";
import { COMPLIMENTARY_MAX_MONTHS, type RentalBooking } from "./schema";
import { monthlyFeeFor } from "../tenants/service";

export class RentalError extends Error {
  override name = "RentalError";
}

export interface LeaseRow {
  id: string;
  reference: string;
  shop_id: string;
  plan: RentalPlanId;
  months: number;
  currency: RentalCurrency;
  amount: number;
  regular_amount: number;
  promo_name: string | null;
  status: LeaseStatus;
  brand_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  website: string | null;
  category: string;
  description: string;
  country: string;
  company_name: string | null;
  vat_id: string | null;
  display_name: string | null;
  display_approved: boolean;
  renews_lease_id: string | null;
  provider: string | null;
  provider_session_id: string | null;
  provider_payment_id: string | null;
  is_test: boolean;
  refunded_amount: number;
  hold_expires_at: Date;
  paid_at: Date | null;
  starts_at: Date | null;
  ends_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  admin_note: string | null;
  /** Signed-in customer who booked (or claimed) the lease: the tenant account (lib/tenants). */
  user_id: string | null;
  /** Platform fee included in `amount` (tenant monthly fee × months). */
  fee_amount: number;
  created_at: Date;
}

export const shopLabel = (shopId: string) => SHOP_UNITS.find((u) => u.id === shopId)?.label ?? shopId.toUpperCase();
export const LEASE_REF_PREFIX = "lease_";

export function toLite(r: Pick<LeaseRow, "id" | "shop_id" | "status" | "starts_at" | "ends_at" | "hold_expires_at" | "display_name" | "display_approved">): LeaseLite {
  return {
    id: r.id, shopId: r.shop_id, status: r.status, startsAt: r.starts_at, endsAt: r.ends_at, holdExpiresAt: r.hold_expires_at,
    displayName: r.display_name, displayApproved: r.display_approved,
  };
}

/** Rows that can still affect availability: paid time not over yet, or a live hold. */
export async function liveLeases(db: Db, shopId?: string): Promise<LeaseLite[]> {
  const rows = await db<LeaseRow[]>`
    select id, shop_id, status, starts_at, ends_at, hold_expires_at, display_name, display_approved from public.shop_leases
     where ((status = 'active' and ends_at > now()) or (status = 'pending_payment' and hold_expires_at > now()))
       ${shopId ? db`and shop_id = ${shopId}` : db``}`;
  return rows.map(toLite);
}

export async function getShopStates(db: Db, now = new Date()): Promise<ShopState[]> {
  return allShopStates(await liveLeases(db), now);
}

async function lockShop(tx: Db, shopId: string) {
  await tx`select pg_advisory_xact_lock(hashtext(${`shop-lease:${shopId}`}))`;
}

const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I
const newReference = () => `RS-${Array.from({ length: 6 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join("")}`;

export async function getLease(db: Db, id: string): Promise<LeaseRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [l] = await db<LeaseRow[]>`select * from public.shop_leases where id = ${id}`;
  return l ?? null;
}

/** Latest paid lease in a tenant's chain for this shop (what a renewal continues from). */
async function chainEnd(db: Db, shopId: string): Promise<LeaseRow | null> {
  const [l] = await db<LeaseRow[]>`
    select * from public.shop_leases where shop_id = ${shopId} and status = 'active' and ends_at > now() order by ends_at desc limit 1`;
  return l ?? null;
}

export type StartRental =
  | { kind: "new"; booking: RentalBooking; userId?: string | null }
  | { kind: "renew"; leaseId: string; plan: RentalPlanId; currency: RentalCurrency };

/** Create the lease (holding the shop) and the payment page. Returns the provider URL to redirect to. */
export async function startRentalCheckout(
  db: Db,
  input: StartRental,
  opts: { provider: PaymentProvider; siteUrl: string; now?: Date },
): Promise<{ redirectUrl: string; leaseId: string; reference: string }> {
  const now = opts.now ?? new Date();
  const lease = await inTx(db, async (tx) => {
    let base: Omit<LeaseRow, "id" | "reference" | "plan" | "months" | "currency" | "amount" | "regular_amount" | "promo_name" | "status" | "created_at" | "hold_expires_at" | "paid_at" | "starts_at" | "ends_at" | "cancelled_at" | "cancel_reason" | "admin_note" | "provider" | "provider_session_id" | "provider_payment_id" | "is_test" | "refunded_amount" | "fee_amount">;
    let plan: RentalPlanId;
    let currency: RentalCurrency;
    if (input.kind === "renew") {
      const prev = await getLease(tx, input.leaseId);
      if (!prev) throw new RentalError("We couldn't find that rental.");
      await lockShop(tx, prev.shop_id);
      const end = await chainEnd(tx, prev.shop_id);
      // Only the tenant whose paid time is running (same email) can extend the shop.
      if (prev.status !== "active" || !end || end.email.toLowerCase() !== prev.email.toLowerCase()) {
        throw new RentalError("This rental has ended, so it can't be extended. You can book a free shop instead.");
      }
      base = {
        shop_id: prev.shop_id, brand_name: prev.brand_name, contact_name: prev.contact_name, email: prev.email, phone: prev.phone,
        website: prev.website, category: prev.category, description: prev.description, country: prev.country,
        company_name: prev.company_name, vat_id: prev.vat_id, display_name: end.display_name, display_approved: end.display_approved,
        renews_lease_id: end.id, user_id: prev.user_id,
      };
      plan = input.plan;
      currency = input.currency;
    } else {
      const b = input.booking;
      await lockShop(tx, b.shopId);
      const state = shopState(b.shopId, await liveLeases(tx, b.shopId), now);
      if (state.state === "rented") throw new RentalError(`${shopLabel(b.shopId)} is already rented. Please pick another shop.`);
      if (state.state === "held") throw new RentalError(`Someone is booking ${shopLabel(b.shopId)} right now. Please pick another shop or try again in ${RENTAL_HOLD_MINUTES} minutes.`);
      base = {
        shop_id: b.shopId, brand_name: b.brandName, contact_name: b.contactName, email: b.email, phone: b.phone ?? null,
        website: b.website ?? null, category: b.category, description: b.description, country: b.country,
        company_name: b.companyName ?? null, vat_id: b.vatId ?? null, display_name: b.brandName.slice(0, 40), display_approved: false,
        renews_lease_id: null, user_id: input.userId ?? null,
      };
      plan = b.plan;
      currency = b.currency;
    }
    const q = quotePlan(plan, currency, now);
    // Fixed platform fee set per tenant by the super admin (lib/tenants), in the lease currency, for every month.
    const fee = (await monthlyFeeFor(tx, base.user_id)) * q.months;
    const hold = new Date(now.getTime() + RENTAL_HOLD_MINUTES * 60_000);
    for (let attempt = 0; ; attempt++) {
      try {
        const [row] = await tx<LeaseRow[]>`
          insert into public.shop_leases (reference, shop_id, plan, months, currency, amount, regular_amount, promo_name, status,
            brand_name, contact_name, email, phone, website, category, description, country, company_name, vat_id, user_id, fee_amount,
            display_name, display_approved, renews_lease_id, is_test, terms_accepted_at, hold_expires_at)
          values (${newReference()}, ${base.shop_id}, ${plan}, ${q.months}, ${currency}, ${q.amount + fee}, ${q.regularAmount + fee},
            ${q.promo ? LAUNCH_PROMO.name : null}, 'pending_payment', ${base.brand_name}, ${base.contact_name}, ${base.email}, ${base.phone},
            ${base.website}, ${base.category}, ${base.description}, ${base.country}, ${base.company_name}, ${base.vat_id}, ${base.user_id ?? null}, ${fee},
            ${base.display_name}, ${base.display_approved}, ${base.renews_lease_id}, ${opts.provider.isSandbox}, ${now}, ${hold})
          returning *`;
        return row!;
      } catch (e) {
        if ((e as { code?: string }).code === "23505" && attempt < 4) continue; // reference collision: draw again
        throw e;
      }
    }
  });

  const label = `WEGO SHIIIP ${shopLabel(lease.shop_id)} rental · ${rentalPlan(lease.plan).name} (${lease.months} month${lease.months > 1 ? "s" : ""}) · ${lease.reference}`;
  try {
    const session = await opts.provider.createSession({
      orderId: `${LEASE_REF_PREFIX}${lease.id}`,
      amount: { amount: lease.amount, currency: lease.currency },
      customerEmail: lease.email,
      successUrl: `${leaseUrl(opts.siteUrl, lease.id)}&paid=1`,
      cancelUrl: `${opts.siteUrl}/rent-a-shop?shop=${lease.shop_id}&cancelled=1`,
      idempotencyKey: `lease:${lease.id}`,
      label,
      expiresInSeconds: RENTAL_SESSION_SECONDS,
    });
    await db`update public.shop_leases set provider = ${opts.provider.id}, provider_session_id = ${session.providerSessionId}, updated_at = now() where id = ${lease.id}`;
    return { redirectUrl: session.redirectUrl, leaseId: lease.id, reference: lease.reference };
  } catch (e) {
    // No payment page: release the shop at once.
    await db`update public.shop_leases set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Payment page could not be created', updated_at = now()
             where id = ${lease.id} and status = 'pending_payment'`;
    throw e;
  }
}

/**
 * Turn a paid lease into an active one (webhook, or an admin resolving a payment review). Caller holds the lease
 * row lock. Returns false when the shop is taken by another paid tenant (the lease goes to payment_review).
 */
export async function activateLease(tx: Db, l: LeaseRow, providerPaymentId: string | null, now = new Date()): Promise<boolean> {
  await lockShop(tx, l.shop_id);
  // A renewal continues the tenant's paid time only while it is still running (not cancelled meanwhile);
  // otherwise it is treated like a new booking and needs the shop to be free.
  const [prev] = l.renews_lease_id
    ? await tx<{ ok: boolean }[]>`select (status = 'active' and ends_at > now()) as ok from public.shop_leases where id = ${l.renews_lease_id}`
    : [];
  const renewing = !!prev?.ok;
  const leases = await liveLeases(tx, l.shop_id);
  const lite = toLite(l);
  if (!canActivate(lite, leases, now, renewing)) {
    await tx`update public.shop_leases set status = 'payment_review', provider_payment_id = coalesce(${providerPaymentId}, provider_payment_id),
               paid_at = coalesce(paid_at, ${now}), updated_at = now() where id = ${l.id}`;
    await notify(tx, {
      kind: "rental_review", severity: "critical", title: `Shop rental ${l.reference} paid, but ${shopLabel(l.shop_id)} is taken`,
      body: `${l.brand_name} (${l.email}) paid ${formatMoney({ amount: l.amount, currency: l.currency })}, but another tenant already rents ${shopLabel(l.shop_id)}. Refund them or move them to a free shop.`,
      link: "/admin/rentals?status=payment_review", dedupeKey: `rental-review:${l.id}`,
    });
    return false;
  }
  const start = leaseStart(l.shop_id, leases.filter((x) => x.id !== l.id), now, renewing);
  const end = addMonths(start, l.months);
  await tx`update public.shop_leases set status = 'active', provider_payment_id = coalesce(${providerPaymentId}, provider_payment_id),
             paid_at = coalesce(paid_at, ${now}), starts_at = ${start}, ends_at = ${end}, updated_at = now() where id = ${l.id}`;
  await queueLeaseConfirmation(tx, { ...l, status: "active", starts_at: start, ends_at: end });
  await notify(tx, {
    kind: "rental_paid", severity: "info",
    title: `${renewing ? "Rental extended" : "New shop rental"}: ${shopLabel(l.shop_id)} · ${l.brand_name}`,
    body: `${rentalPlan(l.plan).name}, ${formatMoney({ amount: l.amount, currency: l.currency })}, until ${end.toISOString().slice(0, 10)}.${renewing ? "" : " Approve the brand name for the 3D sign and contact them about their branding."}`,
    link: "/admin/rentals", dedupeKey: `rental-paid:${l.id}`,
  });
  return true;
}

const day = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—");

async function queueLeaseConfirmation(tx: Db, l: LeaseRow) {
  const site = publicSiteUrl();
  const link = leaseUrl(site, l.id);
  const shop = shopLabel(l.shop_id);
  const renewing = !!l.renews_lease_id;
  const subject = renewing ? `Your ${shop} rental is extended (${l.reference})` : `Your shop in the WEGO SHIIIP 3D store is booked: ${shop} (${l.reference})`;
  const rows = [
    { label: "Booking", value: l.reference },
    { label: "Shop", value: shop },
    { label: "Brand", value: l.brand_name },
    { label: "Plan", value: `${rentalPlan(l.plan).name} · ${l.months} month${l.months > 1 ? "s" : ""}` },
    l.provider === COMPLIMENTARY_PROVIDER
      ? { label: "Price", value: "Free (complimentary rental)" }
      : { label: "Paid", value: `${formatMoney({ amount: l.amount, currency: l.currency })}${l.promo_name ? ` (${l.promo_name})` : ""}` },
    { label: "From", value: day(l.starts_at) },
    { label: "Until", value: day(l.ends_at) },
  ];
  const next = renewing
    ? [{ title: "Nothing to do.", body: "Your shop, sign and branding stay exactly as they are." }]
    : [
        { title: "We check your brand", body: "and put your brand name on your shop's sign in the 3D store, usually within 2 business days." },
        { title: "Send us your branding:", body: "reply to this email with your logo, colours and the products you want shown." },
        { title: "Your shop opens", body: "and shoppers walking the 3D store see it. We'll email you when it's live." },
      ];
  const text = [
    `Hi ${l.contact_name},`,
    "",
    renewing ? `Thank you! Your rental of ${shop} is extended.` : `Thank you! ${shop} in the WEGO SHIIIP 3D store is now reserved for ${l.brand_name}.`,
    "",
    ...rows.map((r) => `${r.label}: ${r.value}`),
    "",
    ...(renewing ? [] : ["What happens next:", ...next.map((s, i) => `${i + 1}. ${s.title} ${s.body}`), ""]),
    `Your rental page (dates, receipt details, extend): ${link}`,
    "",
    "WEGO SHIIIP",
  ].join("\n");
  const html = renderEmail({
    subject, siteUrl: site, eyebrow: renewing ? "Rental extended" : "Shop booked",
    heading: renewing ? `${shop} is yours for longer` : `Welcome to the 3D store, ${l.brand_name}!`,
    intro: renewing ? `Your rental of ${shop} is extended until ${day(l.ends_at)}.` : `${shop} is reserved for you until ${day(l.ends_at)}.`,
    content: detailRows(rows) + (renewing ? "" : steps(next)) + button(link, "Open your rental page") +
      note("Keep this email: it is your booking confirmation. Prices are for the whole term you bought and don't renew automatically."),
  });
  const status = getEmailProvider() ? "queued" : "not_configured";
  await tx`insert into public.email_outbox (to_address, subject, body_text, body_html, template, status, dedupe_key)
           values (${l.email}, ${subject}, ${text}, ${html}, 'shop_rental_confirmed', ${status}, ${`rental-confirmed:${l.id}`})
           on conflict (dedupe_key) where dedupe_key is not null do nothing`;
}

// ───────────────────────── admin ─────────────────────────

export interface LeaseFilter {
  status?: LeaseStatus | "current" | "all";
  q?: string;
}

export async function listLeases(db: Db, f: LeaseFilter = {}, limit = 200): Promise<LeaseRow[]> {
  const q = f.q?.trim() ? `%${f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const st = f.status && f.status !== "all" ? f.status : null;
  return db<LeaseRow[]>`
    select * from public.shop_leases
     where true
       ${st === "current" ? db`and status = 'active' and ends_at > now()` : st ? db`and status = ${st}` : db``}
       ${st === null ? db`and not (status in ('expired_unpaid', 'cancelled') and paid_at is null and created_at < now() - interval '30 days')` : db``}
       ${q ? db`and (reference ilike ${q} or brand_name ilike ${q} or email ilike ${q} or contact_name ilike ${q})` : db``}
     order by created_at desc limit ${limit}`;
}

export interface RentalStats {
  rented: number;
  total: number;
  revenue: { currency: CurrencyCode; amount: number }[];
  expiringSoon: number;
  toReview: number;
  awaitingApproval: number;
}

export async function rentalStats(db: Db): Promise<RentalStats> {
  const [counts] = await db<{ expiring: number; review: number; approval: number }[]>`
    select count(*) filter (where status = 'active' and ends_at > now() and ends_at < now() + interval '14 days'
                              and not exists (select 1 from public.shop_leases n where n.renews_lease_id = l.id and n.status = 'active'))::int as expiring,
           count(*) filter (where status = 'payment_review')::int as review,
           count(*) filter (where status = 'active' and ends_at > now() and starts_at <= now() and not display_approved)::int as approval
      from public.shop_leases l`;
  const revenue = await db<{ currency: CurrencyCode; amount: number }[]>`
    select currency, sum(amount - refunded_amount)::int as amount from public.shop_leases
     where paid_at is not null and not is_test group by currency order by currency`;
  const states = await getShopStates(db);
  return {
    rented: states.filter((s) => s.state === "rented").length, total: states.length, revenue,
    expiringSoon: counts?.expiring ?? 0, toReview: counts?.review ?? 0, awaitingApproval: counts?.approval ?? 0,
  };
}

export async function setLeaseDisplay(db: Db, id: string, displayName: string, approved: boolean): Promise<LeaseRow> {
  const [l] = await db<LeaseRow[]>`update public.shop_leases set display_name = ${displayName}, display_approved = ${approved}, updated_at = now()
                                   where id = ${id} returning *`;
  if (!l) throw new RentalError("Rental not found");
  // Renewals already paid show the same sign.
  await db`update public.shop_leases set display_name = ${displayName}, display_approved = ${approved}, updated_at = now()
           where renews_lease_id = ${id} and status in ('active', 'pending_payment')`;
  return l;
}

export async function setLeaseNote(db: Db, id: string, note: string | null): Promise<void> {
  await db`update public.shop_leases set admin_note = ${note}, updated_at = now() where id = ${id}`;
}

/**
 * Cancel a lease (ends it now) and optionally refund part or all of the payment at the provider. The refund is
 * sent before the row changes; a provider error throws and nothing is changed.
 */
export async function cancelLease(
  db: Db, id: string, opts: { refund: number; reason: string; getProvider?: (id: string) => PaymentProvider | null },
): Promise<LeaseRow> {
  return inTx(db, async (tx) => {
    const [l] = await tx<LeaseRow[]>`select * from public.shop_leases where id = ${id} for update`;
    if (!l) throw new RentalError("Rental not found");
    if (!["active", "payment_review", "pending_payment"].includes(l.status)) throw new RentalError(`This rental is already ${l.status.replace(/_/g, " ")}.`);
    const refund = Math.max(0, Math.trunc(opts.refund));
    if (refund > 0) {
      if (!l.provider || !l.provider_payment_id || !l.paid_at) throw new RentalError("There is no payment to refund.");
      if (refund > l.amount - l.refunded_amount) throw new RentalError("The refund is more than what is left of the payment.");
      const provider = (opts.getProvider ?? getPaymentProvider)(l.provider);
      if (!provider) throw new RentalError(`The payment provider (${l.provider}) is not configured, so the refund can't be sent.`);
      const r = await provider.refund(l.provider_payment_id, { amount: refund, currency: l.currency }, `lease-refund:${l.id}:${l.refunded_amount}:${refund}`, {
        localRefundId: l.id, orderId: `${LEASE_REF_PREFIX}${l.id}`,
      });
      if (r.status === "failed" || r.status === "canceled") throw new RentalError(`The provider refused the refund (${r.status}). Nothing was changed.`);
    }
    const refunded = l.refunded_amount + refund;
    const status: LeaseStatus = l.amount > 0 && refunded >= l.amount ? "refunded" : "cancelled"; // a free lease is cancelled, not refunded
    const [u] = await tx<LeaseRow[]>`
      update public.shop_leases set status = ${status}, refunded_amount = ${refunded}, cancelled_at = now(), cancel_reason = ${opts.reason},
             ends_at = case when ends_at is not null and starts_at < now() and ends_at > now() then now() else ends_at end, updated_at = now()
       where id = ${id} returning *`;
    return u!;
  });
}

/** Admin: activate a paid lease that was put in review (e.g. after the other tenant left). */
export async function resolveReview(db: Db, id: string): Promise<boolean> {
  return inTx(db, async (tx) => {
    const [l] = await tx<LeaseRow[]>`select * from public.shop_leases where id = ${id} for update`;
    if (!l || l.status !== "payment_review") throw new RentalError("Only a rental in payment review can be activated here.");
    return activateLease(tx, l, null);
  });
}

/** Admin: move a lease to another free shop (e.g. to resolve a double booking). */
export async function moveLease(db: Db, id: string, shopId: string): Promise<void> {
  await inTx(db, async (tx) => {
    const [l] = await tx<LeaseRow[]>`select * from public.shop_leases where id = ${id} for update`;
    if (!l) throw new RentalError("Rental not found");
    if (l.renews_lease_id) throw new RentalError("A renewal stays in its shop. Move the first booking instead.");
    await lockShop(tx, shopId);
    const st = shopState(shopId, await liveLeases(tx, shopId));
    if (st.state !== "available") throw new RentalError(`${shopLabel(shopId)} is not free.`);
    await tx`update public.shop_leases set shop_id = ${shopId}, updated_at = now() where id = ${id} or renews_lease_id = ${id}`;
  });
}

// ───────────────────────── complimentary (free) rentals ─────────────────────────

/** `provider` value of a lease a super admin gave for free. The DB allows amount = 0 only with this provider. */
export const COMPLIMENTARY_PROVIDER = "complimentary";
export const COMPLIMENTARY_LABEL = "Complimentary";
export { COMPLIMENTARY_MAX_MONTHS };

export interface ComplimentaryGrant {
  shopId: string;
  /** Who gets the shop: signing in at /seller with this verified email makes the lease theirs (claimLeases). */
  email: string;
  months: number;
  currency: RentalCurrency;
  brandName: string;
  contactName: string;
  country: string;
  note?: string | null;
}

/** Plan stored on a free lease (the table only knows the three paid plans): nearest by length, display only. */
export function complimentaryPlan(months: number): RentalPlanId {
  return months >= 12 ? "yearly" : months >= 3 ? "quarterly" : "monthly";
}

export const isComplimentary = (l: Pick<LeaseRow, "provider">) => l.provider === COMPLIMENTARY_PROVIDER;

/**
 * Super admin: give a shop for free. Creates an `active` lease, amount 0, starting now, with no payment provider
 * involved (no Stripe session, no webhook). Same per-shop advisory lock and availability check as a paid booking,
 * so it never overlaps a paying tenant or a live payment hold. The tenant gets the normal confirmation email.
 */
export async function grantComplimentaryLease(db: Db, g: ComplimentaryGrant, opts: { grantedBy: string; now?: Date }): Promise<LeaseRow> {
  const months = Math.trunc(g.months);
  if (!(months >= 1 && months <= COMPLIMENTARY_MAX_MONTHS)) throw new RentalError(`Months: 1 to ${COMPLIMENTARY_MAX_MONTHS}.`);
  const now = opts.now ?? new Date();
  const lease = await inTx(db, async (tx) => {
    await lockShop(tx, g.shopId);
    const state = shopState(g.shopId, await liveLeases(tx, g.shopId), now);
    if (state.state === "rented") throw new RentalError(`${shopLabel(g.shopId)} is already rented. Pick a free shop.`);
    if (state.state === "held") throw new RentalError(`Someone is paying for ${shopLabel(g.shopId)} right now. Pick another shop or try again in ${RENTAL_HOLD_MINUTES} minutes.`);
    const end = addMonths(now, months);
    const note = [`Complimentary rental given by ${opts.grantedBy} on ${now.toISOString().slice(0, 10)}.`, g.note?.trim()].filter(Boolean).join(" ").slice(0, 2000);
    for (let attempt = 0; ; attempt++) {
      try {
        const [row] = await tx<LeaseRow[]>`
          insert into public.shop_leases (reference, shop_id, plan, months, currency, amount, regular_amount, promo_name, status,
            brand_name, contact_name, email, category, description, country, fee_amount,
            display_name, display_approved, is_test, terms_accepted_at, hold_expires_at, starts_at, ends_at, provider, admin_note)
          values (${newReference()}, ${g.shopId}, ${complimentaryPlan(months)}, ${months}, ${g.currency}, 0, 0, ${COMPLIMENTARY_LABEL}, 'active',
            ${g.brandName}, ${g.contactName}, ${g.email.trim().toLowerCase()}, 'Other',
            ${"Complimentary rental given by the WEGO SHIIIP team."}, ${g.country}, 0,
            ${g.brandName.slice(0, 40)}, false, false, ${now}, ${now}, ${now}, ${end}, ${COMPLIMENTARY_PROVIDER}, ${note})
          returning *`;
        return row!;
      } catch (e) {
        if ((e as { code?: string }).code === "23505" && attempt < 4) continue; // reference collision: draw again
        throw e;
      }
    }
  });
  await queueLeaseConfirmation(db, lease);
  return lease;
}

/** Daily (maintenance cron): remind tenants 7 days before their paid time ends, once per lease. */
export async function queueRentalReminders(db: Db): Promise<number> {
  const due = await db<LeaseRow[]>`
    select l.* from public.shop_leases l
     where l.status = 'active' and l.ends_at > now() and l.ends_at < now() + interval '7 days'
       and not exists (select 1 from public.shop_leases n where n.renews_lease_id = l.id and n.status = 'active')`;
  const site = publicSiteUrl();
  const status = getEmailProvider() ? "queued" : "not_configured";
  let queued = 0;
  for (const l of due) {
    const link = leaseUrl(site, l.id);
    const shop = shopLabel(l.shop_id);
    const subject = `Your ${shop} rental ends on ${day(l.ends_at)}`;
    const text = [
      `Hi ${l.contact_name},`,
      "",
      `Your rental of ${shop} in the WEGO SHIIIP 3D store (${l.brand_name}, ${l.reference}) ends on ${day(l.ends_at)}.`,
      "Extend it now to keep your shop, your sign and your branding. Your new term starts the day after the current one ends, so you lose no days.",
      "",
      `Extend your rental: ${link}`,
      "",
      "If you don't extend, the shop is released to other brands when your rental ends.",
      "",
      "WEGO SHIIIP",
    ].join("\n");
    const html = renderEmail({
      subject, siteUrl: site, eyebrow: "Rental ending soon", heading: `Keep ${shop} for ${l.brand_name}`,
      intro: `Your rental ends on ${day(l.ends_at)}. Extend it now to keep your shop, your sign and your branding.`,
      content: button(link, "Extend my rental") + note("Your new term starts the day after the current one ends, so you lose no days. If you don't extend, the shop is released to other brands."),
    });
    const rows = await db`insert into public.email_outbox (to_address, subject, body_text, body_html, template, status, dedupe_key)
             values (${l.email}, ${subject}, ${text}, ${html}, 'shop_rental_reminder', ${status}, ${`rental-reminder:${l.id}`})
             on conflict (dedupe_key) where dedupe_key is not null do nothing returning id`;
    queued += rows.length;
  }
  return queued;
}

/**
 * Tenant (shop renter) accounts, their storefront and products. A tenant is a signed-in customer who rents (or
 * rented) a shop: shop_leases.user_id links them, and leases booked while signed out are claimed by verified email
 * on first visit to /seller. Everything here runs on the server; callers pass the authenticated user id, never a
 * client-sent tenant id. Products are paid through the tenant's own links: we store and count, never charge.
 */
import { randomUUID } from "node:crypto";
import { SHOP_UNITS } from "@/features/store3d/env/shops";
import { publicStorageUrl } from "../catalog/source-map";
import { inTx, type Db } from "../db/client";
import type { MediaStorage } from "../media/storage";
import type { CurrencyCode } from "../money";
import { doorStyleFrom, type DoorStyle } from "../rentals/door-style";
import type { LeaseRow } from "../rentals/service";
import type { PublicStorefront } from "@/features/rentals/format";
import { checkPaymentLink, linkHost } from "./payment-links";
import type { ProductInput, ProfileInput } from "./schema";

/** Products a tenant can have (one per gondola bay face in the shop, see env/shop-interior.ts). */
export const MAX_PRODUCTS = 48;

export class TenantError extends Error {
  override name = "TenantError";
}

export interface TenantRow {
  id: string;
  user_id: string;
  brand_name: string;
  tagline: string | null;
  about: string | null;
  accent_color: string;
  logo_bucket: string | null;
  logo_path: string | null;
  website: string | null;
  instagram: string | null;
  tiktok: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  default_payment_url: string | null;
  storefront_open: boolean;
  suspended: boolean;
  suspended_reason: string | null;
  monthly_fee: number;
  admin_note: string | null;
  /** Door front in the 3D store (lib/rentals/door-style.ts). */
  door_color: string;
  door_light_color: string;
  door_light_effect: string;
  door_light_level: number;
  created_at: Date;
  updated_at: Date;
}

export interface TenantProductRow {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  price: number;
  currency: "EUR" | "USD";
  image_bucket: string | null;
  image_path: string | null;
  payment_url: string | null;
  status: "draft" | "published";
  hidden_by_admin: boolean;
  hidden_reason: string | null;
  sort: number;
  views: number;
  buy_clicks: number;
  created_at: Date;
  updated_at: Date;
}

export const mediaUrl = (bucket: string | null, path: string | null, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): string | null =>
  bucket && path ? publicStorageUrl(supabaseUrl, bucket, path) : null;

// ───────────────────────────── leases of a tenant ─────────────────────────────

/** Leases booked with this (verified) email while signed out become the user's. Returns how many were claimed. */
export async function claimLeases(db: Db, userId: string, email: string | null | undefined): Promise<number> {
  if (!email) return 0;
  const rows = await db`update public.shop_leases set user_id = ${userId}, updated_at = now()
                        where user_id is null and lower(email) = ${email.toLowerCase()} returning id`;
  return rows.length;
}

export async function tenantLeases(db: Db, userId: string): Promise<LeaseRow[]> {
  return db<LeaseRow[]>`select * from public.shop_leases where user_id = ${userId} order by created_at desc limit 100`;
}

/** The lease paying for today (or null), and the shop it's in. */
export function currentLease(leases: readonly LeaseRow[], now = new Date()): LeaseRow | null {
  return leases.find((l) => l.status === "active" && l.starts_at && l.ends_at && l.starts_at <= now && l.ends_at > now) ?? null;
}

/** Last paid day across the chain of the current shop (renewals continue it). */
export function paidUntil(leases: readonly LeaseRow[], shopId: string, now = new Date()): Date | null {
  const ends = leases.filter((l) => l.shop_id === shopId && l.status === "active" && l.ends_at && l.ends_at > now).map((l) => l.ends_at!.getTime());
  return ends.length ? new Date(Math.max(...ends)) : null;
}

/** Why a tenant's shop isn't visible to shoppers even when opened (null = it is / will be). */
export function openBlocker(hasLease: boolean, suspended: boolean, published: number): string | null {
  if (suspended) return "Paused by our team. Contact us to reopen.";
  if (!hasLease) return "Shoppers see your shop once your rent is paid and your rental period has started.";
  if (published === 0) return "Tip: add at least one product first.";
  return null;
}

/** Leases that make someone a tenant (paid now, paid earlier, or being paid / reviewed). */
const COUNTS = new Set(["active", "pending_payment", "payment_review"]);

// ───────────────────────────── account ─────────────────────────────

export async function getTenantByUser(db: Db, userId: string): Promise<TenantRow | null> {
  const [t] = await db<TenantRow[]>`select * from public.tenant_accounts where user_id = ${userId}`;
  return t ?? null;
}

export async function getTenant(db: Db, id: string): Promise<TenantRow | null> {
  const [t] = await db<TenantRow[]>`select * from public.tenant_accounts where id = ${id}`;
  return t ?? null;
}

/**
 * The signed-in user's tenant account, created on first visit from their latest lease. Null when the user has never
 * booked a shop (they see "Rent a shop" instead).
 */
export async function ensureTenant(db: Db, userId: string, email: string | null | undefined): Promise<{ tenant: TenantRow; leases: LeaseRow[] } | null> {
  await claimLeases(db, userId, email);
  const leases = await tenantLeases(db, userId);
  let tenant = await getTenantByUser(db, userId);
  if (!tenant) {
    const base = leases.find((l) => COUNTS.has(l.status)) ?? leases.find((l) => l.paid_at);
    if (!base) return null;
    const [row] = await db<TenantRow[]>`
      insert into public.tenant_accounts (user_id, brand_name, website, contact_email, contact_phone, about)
      values (${userId}, ${base.brand_name}, ${base.website}, ${base.email}, ${base.phone}, ${base.description})
      on conflict (user_id) do update set updated_at = public.tenant_accounts.updated_at
      returning *`;
    tenant = row!;
  }
  return { tenant, leases };
}

/**
 * Save the brand profile. A new sign name goes on the tenant's running and upcoming leases and waits for the
 * super admin's approval (unchanged name: approval kept).
 */
export async function updateProfile(db: Db, tenant: TenantRow, p: ProfileInput): Promise<{ signPending: boolean }> {
  return inTx(db, async (tx) => {
    await tx`update public.tenant_accounts set brand_name = ${p.brandName}, tagline = ${p.tagline}, about = ${p.about}, accent_color = ${p.accentColor},
               website = ${p.website}, instagram = ${p.instagram}, tiktok = ${p.tiktok}, contact_email = ${p.contactEmail}, contact_phone = ${p.contactPhone},
               default_payment_url = ${p.defaultPaymentUrl}, updated_at = now()
             where id = ${tenant.id}`;
    const changed = await tx`update public.shop_leases set display_name = ${p.signName}, display_approved = false, updated_at = now()
                             where user_id = ${tenant.user_id} and status in ('active', 'pending_payment') and (ends_at is null or ends_at > now())
                               and display_name is distinct from ${p.signName}
                             returning id`;
    return { signPending: changed.length > 0 };
  });
}

/** Door frame colour + lighting of the tenant's shop (validated input: DoorStyleInput). */
export async function setDoorStyle(db: Db, tenantId: string, s: DoorStyle): Promise<void> {
  await db`update public.tenant_accounts set door_color = ${s.frame}, door_light_color = ${s.light}, door_light_effect = ${s.effect},
             door_light_level = ${s.level}, updated_at = now() where id = ${tenantId}`;
}

export async function setStorefrontOpen(db: Db, tenantId: string, open: boolean): Promise<void> {
  await db`update public.tenant_accounts set storefront_open = ${open}, updated_at = now() where id = ${tenantId}`;
}

/** Replace the logo; returns the old object key to delete from storage. */
export async function setLogo(db: Db, tenantId: string, bucket: string | null, path: string | null): Promise<{ bucket: string; path: string } | null> {
  const [old] = await db<{ logo_bucket: string | null; logo_path: string | null }[]>`select logo_bucket, logo_path from public.tenant_accounts where id = ${tenantId} for update`;
  await db`update public.tenant_accounts set logo_bucket = ${bucket}, logo_path = ${path}, updated_at = now() where id = ${tenantId}`;
  return old?.logo_bucket && old.logo_path ? { bucket: old.logo_bucket, path: old.logo_path } : null;
}

/** Storage key for a new tenant image: {tenantId}/{uuid}.webp (matches media OBJECT_KEY). */
export const newImageKey = (tenantId: string) => `${tenantId}/${randomUUID()}.webp`;

/** Remove a stored image unless something still references it. */
export async function removeImageIfUnused(db: Db, storage: MediaStorage, bucket: string, path: string): Promise<void> {
  const [r] = await db<{ n: number }[]>`
    select (select count(*) from public.tenant_products where image_bucket = ${bucket} and image_path = ${path})::int
         + (select count(*) from public.tenant_accounts where logo_bucket = ${bucket} and logo_path = ${path})::int as n`;
  if ((r?.n ?? 0) === 0 && storage.bucket === bucket) {
    try {
      await storage.remove([path]);
    } catch (e) {
      console.error("[tenant image] could not delete (orphan cleanup will retry)", path, e);
    }
  }
}

// ───────────────────────────── products ─────────────────────────────

export async function listProducts(db: Db, tenantId: string): Promise<TenantProductRow[]> {
  return db<TenantProductRow[]>`select * from public.tenant_products where tenant_id = ${tenantId} order by sort, created_at`;
}

/** A product of THIS tenant (ownership enforced in the query). */
export async function getOwnProduct(db: Db, tenantId: string, id: string): Promise<TenantProductRow | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [p] = await db<TenantProductRow[]>`select * from public.tenant_products where id = ${id} and tenant_id = ${tenantId}`;
  return p ?? null;
}

export async function createProduct(db: Db, tenantId: string, p: ProductInput): Promise<TenantProductRow> {
  return inTx(db, async (tx) => {
    await tx`select id from public.tenant_accounts where id = ${tenantId} for update`; // serialise the count check
    const [c] = await tx<{ n: number; next: number }[]>`
      select count(*)::int as n, coalesce(max(sort), 0)::int + 1 as next from public.tenant_products where tenant_id = ${tenantId}`;
    const n = c?.n ?? 0;
    const next = c?.next ?? 1;
    if (n >= MAX_PRODUCTS) throw new TenantError(`Your shop holds up to ${MAX_PRODUCTS} products. Remove one to add another.`);
    const [row] = await tx<TenantProductRow[]>`
      insert into public.tenant_products (tenant_id, title, description, price, currency, payment_url, status, sort)
      values (${tenantId}, ${p.title}, ${p.description}, ${p.price}, ${p.currency}, ${p.paymentUrl}, ${p.publish ? "published" : "draft"}, ${next})
      returning *`;
    return row!;
  });
}

export async function updateProduct(db: Db, tenantId: string, id: string, p: ProductInput): Promise<TenantProductRow> {
  const [row] = await db<TenantProductRow[]>`
    update public.tenant_products set title = ${p.title}, description = ${p.description}, price = ${p.price}, currency = ${p.currency},
      payment_url = ${p.paymentUrl}, status = ${p.publish ? "published" : "draft"}, updated_at = now()
    where id = ${id} and tenant_id = ${tenantId} returning *`;
  if (!row) throw new TenantError("That product no longer exists.");
  return row;
}

export async function setProductStatus(db: Db, tenantId: string, id: string, publish: boolean): Promise<void> {
  const r = await db`update public.tenant_products set status = ${publish ? "published" : "draft"}, updated_at = now() where id = ${id} and tenant_id = ${tenantId} returning id`;
  if (!r.length) throw new TenantError("That product no longer exists.");
}

/** Delete; returns the image to remove from storage. */
export async function deleteProduct(db: Db, tenantId: string, id: string): Promise<{ bucket: string; path: string } | null> {
  const [row] = await db<TenantProductRow[]>`delete from public.tenant_products where id = ${id} and tenant_id = ${tenantId} returning *`;
  if (!row) throw new TenantError("That product no longer exists.");
  return row.image_bucket && row.image_path ? { bucket: row.image_bucket, path: row.image_path } : null;
}

/** Move a product one place up/down in the shelf order. */
export async function moveProduct(db: Db, tenantId: string, id: string, dir: -1 | 1): Promise<void> {
  await inTx(db, async (tx) => {
    const rows = await tx<{ id: string }[]>`select id from public.tenant_products where tenant_id = ${tenantId} order by sort, created_at for update`;
    const i = rows.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    for (let k = 0; k < rows.length; k++) await tx`update public.tenant_products set sort = ${k + 1} where id = ${rows[k]!.id}`;
  });
}

/** Replace a product's photo; returns the old one to remove. */
export async function setProductImage(db: Db, tenantId: string, id: string, bucket: string, path: string): Promise<{ bucket: string; path: string } | null> {
  const [old] = await db<TenantProductRow[]>`select * from public.tenant_products where id = ${id} and tenant_id = ${tenantId}`;
  if (!old) throw new TenantError("That product no longer exists.");
  await db`update public.tenant_products set image_bucket = ${bucket}, image_path = ${path}, updated_at = now() where id = ${id}`;
  return old.image_bucket && old.image_path ? { bucket: old.image_bucket, path: old.image_path } : null;
}

// ───────────────────────────── stats ─────────────────────────────

export interface TenantStats {
  published: number;
  drafts: number;
  views30: number;
  clicks30: number;
  /** Last 30 days, oldest first (zero-filled). */
  daily: { day: string; views: number; clicks: number }[];
  top: { id: string; title: string; views: number; clicks: number }[];
}

export async function tenantStats(db: Db, tenantId: string, now = new Date()): Promise<TenantStats> {
  const [counts, daily, top] = await Promise.all([
    db<{ published: number; drafts: number }[]>`
      select count(*) filter (where status = 'published' and not hidden_by_admin)::int as published,
             count(*) filter (where status = 'draft')::int as drafts
        from public.tenant_products where tenant_id = ${tenantId}`,
    db<{ day: string; views: number; clicks: number }[]>`
      select to_char(s.day, 'YYYY-MM-DD') as day, sum(s.views)::int as views, sum(s.buy_clicks)::int as clicks
        from public.tenant_product_stats s join public.tenant_products p on p.id = s.product_id
       where p.tenant_id = ${tenantId} and s.day > (${now}::date - 30)
       group by 1`,
    db<{ id: string; title: string; views: number; clicks: number }[]>`
      select p.id, p.title, coalesce(sum(s.views), 0)::int as views, coalesce(sum(s.buy_clicks), 0)::int as clicks
        from public.tenant_products p left join public.tenant_product_stats s on s.product_id = p.id and s.day > (${now}::date - 30)
       where p.tenant_id = ${tenantId} group by p.id, p.title order by clicks desc, views desc limit 5`,
  ]);
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const series: TenantStats["daily"] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const d = byDay.get(day);
    series.push({ day, views: d?.views ?? 0, clicks: d?.clicks ?? 0 });
  }
  return {
    published: counts[0]?.published ?? 0,
    drafts: counts[0]?.drafts ?? 0,
    views30: series.reduce((s, d) => s + d.views, 0),
    clicks30: series.reduce((s, d) => s + d.clicks, 0),
    daily: series,
    top: top.filter((t) => t.views || t.clicks),
  };
}

// ───────────────────────────── public (3D store) ─────────────────────────────

/** Open storefronts by shop id: running lease of a tenant whose shop is open and not suspended. */
export async function loadStorefronts(db: Db, now = new Date()): Promise<Record<string, PublicStorefront>> {
  const shops = await db<(TenantRow & { shop_id: string })[]>`
    select distinct on (l.shop_id) l.shop_id, t.*
      from public.shop_leases l join public.tenant_accounts t on t.user_id = l.user_id
     where l.status = 'active' and l.starts_at <= ${now} and l.ends_at > ${now}
       and t.storefront_open and not t.suspended
     order by l.shop_id, l.ends_at desc`;
  if (!shops.length) return {};
  const ids = [...new Set(shops.map((s) => s.id))];
  const products = await db<TenantProductRow[]>`
    select * from public.tenant_products
     where tenant_id in ${db(ids)} and status = 'published' and not hidden_by_admin
     order by sort, created_at`;
  const out: Record<string, PublicStorefront> = {};
  for (const s of shops) {
    if (!SHOP_UNITS.some((u) => u.id === s.shop_id)) continue;
    out[s.shop_id] = {
      tenantId: s.id,
      brand: s.brand_name,
      tagline: s.tagline,
      about: s.about,
      accent: s.accent_color,
      logoUrl: mediaUrl(s.logo_bucket, s.logo_path),
      website: s.website,
      instagram: s.instagram,
      products: products
        .filter((p) => p.tenant_id === s.id)
        .slice(0, MAX_PRODUCTS)
        .map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          price: p.price,
          currency: p.currency,
          imageUrl: mediaUrl(p.image_bucket, p.image_path),
          buyHost: linkHost(p.payment_url ?? s.default_payment_url),
        })),
    };
  }
  return out;
}

/**
 * Door styles by shop id for every shop with a running lease whose tenant is not suspended (open or not yet open:
 * the door is theirs from day one).
 */
export async function loadDoorStyles(db: Db, now = new Date()): Promise<Record<string, DoorStyle>> {
  const rows = await db<{ shop_id: string; door_color: string; door_light_color: string; door_light_effect: string; door_light_level: number }[]>`
    select distinct on (l.shop_id) l.shop_id, t.door_color, t.door_light_color, t.door_light_effect, t.door_light_level
      from public.shop_leases l join public.tenant_accounts t on t.user_id = l.user_id
     where l.status = 'active' and l.starts_at <= ${now} and l.ends_at > ${now} and not t.suspended
     order by l.shop_id, l.ends_at desc`;
  const out: Record<string, DoorStyle> = {};
  for (const r of rows) if (SHOP_UNITS.some((u) => u.id === r.shop_id)) out[r.shop_id] = doorStyleFrom(r);
  return out;
}

/** Where a shopper's "Buy" goes, only while the product is on show. Counts the click. */
export async function buyTarget(db: Db, productId: string, now = new Date(), count = true): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/.test(productId)) return null;
  const [row] = await db<{ url: string | null }[]>`
    select coalesce(p.payment_url, t.default_payment_url) as url
      from public.tenant_products p join public.tenant_accounts t on t.id = p.tenant_id
     where p.id = ${productId} and p.status = 'published' and not p.hidden_by_admin and t.storefront_open and not t.suspended
       and exists (select 1 from public.shop_leases l where l.user_id = t.user_id and l.status = 'active' and l.starts_at <= ${now} and l.ends_at > ${now})`;
  if (!row?.url) return null;
  if (count) await bump(db, productId, "buy_clicks", now);
  return row.url;
}

/** A shopper opened the product in the store. */
export async function recordView(db: Db, productId: string, now = new Date()): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(productId)) return;
  const [p] = await db<{ id: string }[]>`select id from public.tenant_products where id = ${productId} and status = 'published' and not hidden_by_admin`;
  if (p) await bump(db, productId, "views", now);
}

async function bump(db: Db, productId: string, col: "views" | "buy_clicks", now: Date) {
  const day = now.toISOString().slice(0, 10);
  if (col === "views") {
    await db`update public.tenant_products set views = views + 1 where id = ${productId}`;
    await db`insert into public.tenant_product_stats (product_id, day, views) values (${productId}, ${day}, 1)
             on conflict (product_id, day) do update set views = public.tenant_product_stats.views + 1`;
  } else {
    await db`update public.tenant_products set buy_clicks = buy_clicks + 1 where id = ${productId}`;
    await db`insert into public.tenant_product_stats (product_id, day, buy_clicks) values (${productId}, ${day}, 1)
             on conflict (product_id, day) do update set buy_clicks = public.tenant_product_stats.buy_clicks + 1`;
  }
}

// ───────────────────────────── super admin ─────────────────────────────

export interface TenantListRow extends TenantRow {
  email: string | null;
  shop_id: string | null;
  lease_until: Date | null;
  currency: CurrencyCode | null;
  products: number;
  published: number;
  hidden: number;
  views30: number;
  clicks30: number;
  sign_pending: boolean;
}

export async function listTenants(db: Db, q = ""): Promise<TenantListRow[]> {
  const like = `%${q.trim().toLowerCase()}%`;
  return db<TenantListRow[]>`
    select t.*,
      cur.email, cur.shop_id, cur.ends_at as lease_until, cur.currency, coalesce(cur.sign_pending, false) as sign_pending,
      (select count(*)::int from public.tenant_products p where p.tenant_id = t.id) as products,
      (select count(*)::int from public.tenant_products p where p.tenant_id = t.id and p.status = 'published' and not p.hidden_by_admin) as published,
      (select count(*)::int from public.tenant_products p where p.tenant_id = t.id and p.hidden_by_admin) as hidden,
      (select coalesce(sum(s.views), 0)::int from public.tenant_product_stats s join public.tenant_products p on p.id = s.product_id
        where p.tenant_id = t.id and s.day > current_date - 30) as views30,
      (select coalesce(sum(s.buy_clicks), 0)::int from public.tenant_product_stats s join public.tenant_products p on p.id = s.product_id
        where p.tenant_id = t.id and s.day > current_date - 30) as clicks30
    from public.tenant_accounts t
    left join lateral (
      select l.email, l.shop_id, l.ends_at, l.currency, (l.display_name is not null and not l.display_approved) as sign_pending
        from public.shop_leases l where l.user_id = t.user_id and l.status in ('active', 'pending_payment', 'payment_review')
       order by (l.status = 'active' and l.starts_at <= now() and l.ends_at > now()) desc, l.ends_at desc nulls last limit 1
    ) cur on true
    where ${q.trim() ? db`(lower(t.brand_name) like ${like} or lower(coalesce(cur.email, '')) like ${like} or lower(coalesce(t.contact_email, '')) like ${like})` : db`true`}
    order by t.created_at desc
    limit 300`;
}

export async function setMonthlyFee(db: Db, tenantId: string, fee: number): Promise<void> {
  await db`update public.tenant_accounts set monthly_fee = ${fee}, updated_at = now() where id = ${tenantId}`;
}

export async function setSuspended(db: Db, tenantId: string, suspended: boolean, reason: string | null): Promise<void> {
  await db`update public.tenant_accounts set suspended = ${suspended}, suspended_reason = ${suspended ? reason : null}, updated_at = now() where id = ${tenantId}`;
}

export async function setTenantNote(db: Db, tenantId: string, note: string | null): Promise<void> {
  await db`update public.tenant_accounts set admin_note = ${note}, updated_at = now() where id = ${tenantId}`;
}

export async function setProductHidden(db: Db, productId: string, hidden: boolean, reason: string | null): Promise<TenantProductRow | null> {
  const [row] = await db<TenantProductRow[]>`
    update public.tenant_products set hidden_by_admin = ${hidden}, hidden_reason = ${hidden ? reason : null}, updated_at = now()
     where id = ${productId} returning *`;
  return row ?? null;
}

/** Monthly platform fee for a user's next rent payment (0 when none / no tenant account). */
export async function monthlyFeeFor(db: Db, userId: string | null | undefined): Promise<number> {
  if (!userId) return 0;
  const [r] = await db<{ monthly_fee: number }[]>`select monthly_fee from public.tenant_accounts where user_id = ${userId}`;
  return r?.monthly_fee ?? 0;
}

/** What the "you are leaving" page shows (no click counted). The link is re-validated against today's rules. */
export async function leaveInfo(db: Db, productId: string, now = new Date()): Promise<{ title: string; brand: string; host: string; recognised: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/.test(productId)) return null;
  const [row] = await db<{ url: string | null; title: string; brand: string }[]>`
    select coalesce(p.payment_url, t.default_payment_url) as url, p.title, t.brand_name as brand
      from public.tenant_products p join public.tenant_accounts t on t.id = p.tenant_id
     where p.id = ${productId} and p.status = 'published' and not p.hidden_by_admin and t.storefront_open and not t.suspended
       and exists (select 1 from public.shop_leases l where l.user_id = t.user_id and l.status = 'active' and l.starts_at <= ${now} and l.ends_at > ${now})`;
  if (!row?.url) return null;
  const check = checkPaymentLink(row.url);
  if (!check.ok) return null;
  return { title: row.title, brand: row.brand, host: check.host.replace(/^www\./, ""), recognised: check.provider?.name ?? null };
}

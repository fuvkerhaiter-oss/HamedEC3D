/** Customers (privacy-controlled), reviews moderation, admin users, activity log. */
import { inTx, type Db } from "../../db/client";
import { logActivity, type Actor } from "../audit";
import { createAdminUser, revokeAllSessions, changePassword } from "../auth";
import { canManageAdmin, isAdminRole, isPermission, type AdminRole } from "../permissions";

// ───────────────────────── Customers ─────────────────────────

/** "jane.doe@example.com" → "j•••e@example.com". */
export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  if (!domain) return "•••";
  const shown = user.length <= 2 ? user[0] ?? "" : `${user[0]}•••${user[user.length - 1]}`;
  return `${shown}@${domain}`;
}

export function maskName(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(" ");
}

export interface CustomerRow {
  email: string;
  user_id: string | null;
  name: string | null;
  orders: number;
  paid_orders: number;
  spent_eur: number;
  spent_usd: number;
  first_order: Date;
  last_order: Date;
  countries: string[];
}

/** Customers are derived from orders (guest + registered) joined with storefront profiles. */
export async function listCustomers(db: Db, f: { q?: string; page?: number; pageSize?: number }) {
  const q = f.q?.trim() ?? "";
  const pageSize = Math.min(f.pageSize ?? 25, 100);
  const page = Math.max(1, f.page ?? 1);
  const base = db`
    from public.orders o
    where (${q} = '' or o.email ilike ${"%" + q + "%"} or o.shipping_address->>'fullName' ilike ${"%" + q + "%"})
    group by lower(o.email)`;
  const [count] = await db<{ n: number }[]>`select count(*)::int as n from (select 1 ${base}) t`;
  const rows = await db<CustomerRow[]>`
    select lower(o.email) as email, (array_agg(o.user_id) filter (where o.user_id is not null))[1] as user_id,
      (array_agg(o.shipping_address->>'fullName' order by o.created_at desc))[1] as name,
      count(*)::int as orders,
      count(*) filter (where o.status not in ('pending_payment','cancelled','failed'))::int as paid_orders,
      coalesce(sum(o.total) filter (where o.currency = 'EUR' and o.status not in ('pending_payment','cancelled','failed')), 0)::bigint as spent_eur,
      coalesce(sum(o.total) filter (where o.currency = 'USD' and o.status not in ('pending_payment','cancelled','failed')), 0)::bigint as spent_usd,
      min(o.created_at) as first_order, max(o.created_at) as last_order, array_agg(distinct o.ship_country::text) as countries
    ${base}
    order by max(o.created_at) desc limit ${pageSize} offset ${(page - 1) * pageSize}`;
  const [registered] = await db<{ n: number }[]>`select count(*)::int as n from public.profiles`;
  return { rows, total: count?.n ?? 0, registered: registered?.n ?? 0 };
}

export async function getCustomer(db: Db, email: string) {
  const orders = await db<{ id: string; order_number: number; status: string; currency: string; total: number; created_at: Date; shipping_address: Record<string, string> }[]>`
    select id, order_number, status, currency, total, created_at, shipping_address from public.orders where lower(email) = lower(${email}) order by created_at desc limit 200`;
  return orders.length ? { email: email.toLowerCase(), orders } : null;
}

// ───────────────────────── Reviews ─────────────────────────

export async function listReviews(db: Db, status?: string) {
  return db<{ id: string; product_id: string; product_name: string; author_name: string; rating: number; title: string; body: string; status: string; is_verified_purchase: boolean; created_at: Date; moderated_at: Date | null }[]>`
    select r.*, p.name as product_name from public.reviews r join public.products p on p.id = r.product_id
     where (${status ?? null}::text is null or r.status = ${status ?? null}) order by r.created_at desc limit 200`;
}

export async function moderateReview(db: Db, actor: Actor, id: string, status: "approved" | "rejected" | "hidden" | "pending") {
  const [r] = await db<{ status: string }[]>`select status from public.reviews where id = ${id}`;
  if (!r) throw new Error("Review not found");
  await db`update public.reviews set status = ${status}, moderated_by = ${actor.id}, moderated_at = now() where id = ${id}`;
  await logActivity(db, actor, { action: "review.moderate", entity: "review", entityId: id, summary: `Review ${r.status} → ${status}`, before: { status: r.status }, after: { status } });
}

/**
 * Verified purchase is set ONLY when the linked order was delivered to the reviewer and contains the product.
 * Called when a review is created (storefront) — never settable by an admin.
 */
export async function verifyPurchase(db: Db, reviewId: string): Promise<boolean> {
  const [r] = await db<{ ok: boolean }[]>`
    update public.reviews r set is_verified_purchase = exists (
      select 1 from public.orders o join public.order_items oi on oi.order_id = o.id join public.product_variants v on v.id = oi.variant_id
       where o.id = r.order_id and o.status = 'delivered' and v.product_id = r.product_id
         and (r.user_id is null or o.user_id = r.user_id))
    where r.id = ${reviewId} returning is_verified_purchase as ok`;
  return r?.ok ?? false;
}

// ───────────────────────── Admin users ─────────────────────────

export async function listAdmins(db: Db) {
  return db<{ id: string; email: string; full_name: string; role: AdminRole; is_active: boolean; extra_permissions: string[]; revoked_permissions: string[]; last_login_at: Date | null; locked_until: Date | null; created_at: Date; active_sessions: number }[]>`
    select u.id, u.email, u.full_name, u.role, u.is_active, u.extra_permissions, u.revoked_permissions, u.last_login_at, u.locked_until, u.created_at,
      (select count(*)::int from public.admin_sessions s where s.admin_user_id = u.id and s.revoked_at is null and s.expires_at > now()) as active_sessions
    from public.admin_users u order by u.is_active desc, u.role, u.email`;
}

export async function inviteAdmin(db: Db, actor: Actor & { role: AdminRole }, input: { email: string; fullName: string; role: AdminRole; password: string }) {
  if (actor.role !== "SUPER_ADMIN") throw new Error("Only a super admin can add admins");
  const user = await createAdminUser(db, { ...input, createdBy: actor.id });
  await logActivity(db, actor, { action: "admin.create", entity: "admin_user", entityId: user.id, summary: `Added ${user.email} as ${user.role}` });
  return user;
}

export async function updateAdmin(
  db: Db, actor: Actor & { role: AdminRole },
  input: { id: string; role: AdminRole; isActive: boolean; extra: string[]; revoked: string[]; fullName: string },
) {
  return inTx(db, async (tx) => {
    const [target] = await tx<{ id: string; role: AdminRole; is_active: boolean; email: string; extra_permissions: string[]; revoked_permissions: string[] }[]>`
      select id, role, is_active, email, extra_permissions, revoked_permissions from public.admin_users where id = ${input.id} for update`;
    if (!target) throw new Error("Admin not found");
    if (!isAdminRole(input.role)) throw new Error("Unknown role");
    if (!canManageAdmin(actor, target, { role: input.role, deactivate: !input.isActive })) throw new Error("You can't change your own role or deactivate yourself");
    if (target.role === "SUPER_ADMIN" && (input.role !== "SUPER_ADMIN" || !input.isActive)) {
      const [{ n }] = (await tx<{ n: number }[]>`select count(*)::int as n from public.admin_users where role = 'SUPER_ADMIN' and is_active`) as unknown as [{ n: number }];
      if (n <= 1) throw new Error("There must always be at least one active super admin");
    }
    // A role change resets per-user overrides (they were expressed relative to the old role).
    const roleChanged = input.role !== target.role;
    const extra = roleChanged ? [] : input.extra.filter(isPermission);
    const revoked = roleChanged ? [] : input.revoked.filter(isPermission);
    await tx`update public.admin_users set role = ${input.role}, is_active = ${input.isActive}, extra_permissions = ${extra}, revoked_permissions = ${revoked},
             full_name = ${input.fullName}, updated_at = now() where id = ${input.id}`;
    if (!input.isActive || input.role !== target.role) await revokeAllSessions(tx, input.id);
    await logActivity(tx, actor, {
      action: "admin.update", entity: "admin_user", entityId: input.id, summary: `Updated ${target.email}`,
      before: { role: target.role, is_active: target.is_active, extra: target.extra_permissions, revoked: target.revoked_permissions },
      after: { role: input.role, is_active: input.isActive, extra, revoked },
    });
  });
}

export async function resetAdminPassword(db: Db, actor: Actor & { role: AdminRole }, id: string, password: string) {
  if (actor.role !== "SUPER_ADMIN" && actor.id !== id) throw new Error("Not allowed");
  await changePassword(db, id, password);
  await logActivity(db, actor, { action: "admin.password", entity: "admin_user", entityId: id, summary: actor.id === id ? "Changed own password" : "Reset an admin's password" });
}

// ───────────────────────── Activity log ─────────────────────────

export async function listActivity(db: Db, f: { q?: string; entity?: string; adminId?: string; page?: number; pageSize?: number }) {
  const q = f.q?.trim() ?? "";
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(1, f.page ?? 1);
  return db<{ id: number; admin_email: string | null; action: string; entity: string; entity_id: string | null; summary: string; before: unknown; after: unknown; ip: string | null; created_at: Date }[]>`
    select id, admin_email, action, entity, entity_id, summary, before, after, ip, created_at from public.admin_activity_log
     where (${f.entity ?? null}::text is null or entity = ${f.entity ?? null})
       and (${f.adminId ?? null}::uuid is null or admin_user_id = ${f.adminId ?? null})
       and (${q} = '' or summary ilike ${"%" + q + "%"} or action ilike ${"%" + q + "%"} or entity_id = ${q})
     order by created_at desc, id desc limit ${pageSize} offset ${(page - 1) * pageSize}`;
}

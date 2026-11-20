/**
 * Admin authentication core (framework-agnostic, integration tested). Admin accounts live in
 * `admin_users`, separate from storefront customers. Sessions are random tokens stored only as sha256
 * hashes; the raw token lives in an httpOnly cookie.
 */
import type { Db } from "../db/client";
import { DUMMY_HASH, hashPassword, newToken, passwordProblem, sha256, verifyPassword } from "./password";
import { effectivePermissions, isAdminRole, type AdminRole, type Permission } from "./permissions";

export const SESSION_TTL_HOURS = 12;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: AdminRole;
  isActive: boolean;
  extraPermissions: string[];
  revokedPermissions: string[];
  lastLoginAt: string | null;
}

export interface AdminSession {
  user: AdminUser;
  permissions: Set<Permission>;
  sessionId: string;
}

interface AdminRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  extra_permissions: string[];
  revoked_permissions: string[];
  last_login_at: Date | null;
  password_hash: string;
  failed_login_count: number;
  locked_until: Date | null;
}

function toUser(r: AdminRow): AdminUser {
  if (!isAdminRole(r.role)) throw new Error(`Unknown admin role ${r.role}`);
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    role: r.role,
    isActive: r.is_active,
    extraPermissions: r.extra_permissions,
    revokedPermissions: r.revoked_permissions,
    lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
  };
}

export class AuthError extends Error {
  override name = "AuthError";
}

export async function createAdminUser(
  db: Db,
  input: { email: string; fullName: string; password: string; role: AdminRole; createdBy?: string | null },
): Promise<AdminUser> {
  const problem = passwordProblem(input.password);
  if (problem) throw new AuthError(problem);
  const hash = await hashPassword(input.password);
  const [row] = await db<AdminRow[]>`
    insert into public.admin_users (email, full_name, password_hash, role, created_by)
    values (${input.email.trim().toLowerCase()}, ${input.fullName.trim()}, ${hash}, ${input.role}, ${input.createdBy ?? null})
    returning *`;
  return toUser(row!);
}

export type LoginResult =
  | { ok: true; token: string; user: AdminUser; expiresAt: Date }
  | { ok: false; reason: "invalid" | "locked" | "inactive" };

/** Verifies credentials with lockout after repeated failures. Error messages never reveal whether the email exists. */
export async function login(db: Db, email: string, password: string, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<LoginResult> {
  const [row] = await db<AdminRow[]>`select * from public.admin_users where lower(email) = ${email.trim().toLowerCase()}`;
  if (!row) {
    await verifyPassword(password, DUMMY_HASH).catch(() => false); // equalize timing
    return { ok: false, reason: "invalid" };
  }
  if (row.locked_until && row.locked_until > new Date()) return { ok: false, reason: "locked" };
  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    await db`
      update public.admin_users set
        failed_login_count = case when failed_login_count + 1 >= ${MAX_FAILED_LOGINS} then 0 else failed_login_count + 1 end,
        locked_until = case when failed_login_count + 1 >= ${MAX_FAILED_LOGINS} then now() + make_interval(mins => ${LOCKOUT_MINUTES}) else locked_until end
      where id = ${row.id}`;
    return { ok: false, reason: "invalid" };
  }
  if (!row.is_active) return { ok: false, reason: "inactive" };

  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000);
  await db`
    insert into public.admin_sessions (admin_user_id, token_hash, ip, user_agent, expires_at)
    values (${row.id}, ${sha256(token)}, ${meta.ip ?? null}, ${meta.userAgent?.slice(0, 500) ?? null}, ${expiresAt})`;
  await db`update public.admin_users set failed_login_count = 0, locked_until = null, last_login_at = now() where id = ${row.id}`;
  return { ok: true, token, user: toUser(row), expiresAt };
}

/** Resolves a session token to an active admin. Returns null for unknown/expired/revoked sessions or deactivated admins. */
export async function getSessionAdmin(db: Db, token: string | undefined | null): Promise<AdminSession | null> {
  if (!token || token.length > 200) return null;
  const rows = await db<(AdminRow & { session_id: string; last_seen_at: Date })[]>`
    select u.*, s.id as session_id, s.last_seen_at
      from public.admin_sessions s join public.admin_users u on u.id = s.admin_user_id
     where s.token_hash = ${sha256(token)} and s.revoked_at is null and s.expires_at > now() and u.is_active`;
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - row.last_seen_at.getTime() > 5 * 60_000) {
    await db`update public.admin_sessions set last_seen_at = now() where id = ${row.session_id}`;
  }
  const user = toUser(row);
  return { user, permissions: effectivePermissions(user.role, user.extraPermissions, user.revokedPermissions), sessionId: row.session_id };
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db`update public.admin_sessions set revoked_at = now() where token_hash = ${sha256(token)} and revoked_at is null`;
}

export async function revokeAllSessions(db: Db, adminUserId: string): Promise<void> {
  await db`update public.admin_sessions set revoked_at = now() where admin_user_id = ${adminUserId} and revoked_at is null`;
}

export async function changePassword(db: Db, adminUserId: string, newPassword: string): Promise<void> {
  const problem = passwordProblem(newPassword);
  if (problem) throw new AuthError(problem);
  const hash = await hashPassword(newPassword);
  await db`update public.admin_users set password_hash = ${hash}, password_changed_at = now() where id = ${adminUserId}`;
  await revokeAllSessions(db, adminUserId);
}

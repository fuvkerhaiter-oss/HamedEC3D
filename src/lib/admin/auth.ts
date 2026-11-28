/**
 * Admin authentication core (framework-agnostic, integration tested). Admin accounts live in
 * `admin_users`, separate from storefront customers. Sessions are random tokens stored only as sha256
 * hashes; the raw token lives in an httpOnly cookie.
 */
import type { Db } from "../db/client";
import { DUMMY_HASH, hashPassword, newToken, passwordProblem, sha256, verifyPassword } from "./password";
import { effectivePermissions, isAdminRole, type AdminRole, type Permission } from "./permissions";
import { decryptSecret, encryptSecret, hashRecoveryCode, matchRecoveryCode, mfaKey, newRecoveryCodes, newTotpSecret, verifyTotp } from "./totp";

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
  /** Two-factor (TOTP) is enrolled and confirmed. */
  mfaEnabled: boolean;
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
  totp_secret_enc: string | null;
  totp_enabled_at: Date | null;
  totp_last_step: string | number | null;
  totp_recovery_hashes: string[] | null;
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
    mfaEnabled: Boolean(r.totp_enabled_at && r.totp_secret_enc),
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
  | { ok: false; reason: "invalid" | "locked" | "inactive" | "mfa_required" | "mfa_invalid" | "mfa_unavailable" };

async function countFailure(db: Db, id: string): Promise<void> {
  await db`
    update public.admin_users set
      failed_login_count = case when failed_login_count + 1 >= ${MAX_FAILED_LOGINS} then 0 else failed_login_count + 1 end,
      locked_until = case when failed_login_count + 1 >= ${MAX_FAILED_LOGINS} then now() + make_interval(mins => ${LOCKOUT_MINUTES}) else locked_until end
    where id = ${id}`;
}

/**
 * Checks the second factor: a TOTP code (replay-protected) or a single-use recovery code (consumed on use).
 * The conditional updates make each step / recovery code usable once even under concurrent requests.
 */
async function verifySecondFactor(db: Db, row: AdminRow, code: string): Promise<"ok" | "invalid" | "unavailable"> {
  const key = mfaKey();
  if (!key || !row.totp_secret_enc) return "unavailable";
  const c = code.trim();
  if (/^\d{3}\s?\d{3}$/.test(c)) {
    let secret: string;
    try {
      secret = decryptSecret(row.totp_secret_enc, key);
    } catch {
      return "unavailable"; // ADMIN_MFA_KEY changed: use a recovery code or the reset tool
    }
    const last = row.totp_last_step == null ? null : Number(row.totp_last_step);
    const step = verifyTotp(secret, c, { lastStep: last });
    if (step === null) return "invalid";
    const upd = await db`update public.admin_users set totp_last_step = ${step}
                          where id = ${row.id} and (totp_last_step is null or totp_last_step < ${step}) returning id`;
    return upd.length ? "ok" : "invalid";
  }
  const hashes = row.totp_recovery_hashes ?? [];
  const i = matchRecoveryCode(c, hashes);
  if (i < 0) return "invalid";
  const h = hashes[i]!;
  const upd = await db`update public.admin_users set totp_recovery_hashes = array_remove(totp_recovery_hashes, ${h})
                        where id = ${row.id} and ${h} = any(totp_recovery_hashes) returning id`;
  return upd.length ? "ok" : "invalid";
}

/**
 * Verifies credentials with lockout after repeated failures. Error messages never reveal whether the email exists.
 * With two-factor enrolled, a correct password alone returns "mfa_required"; a wrong code counts as a failure.
 */
export async function login(db: Db, email: string, password: string, meta: { ip?: string | null; userAgent?: string | null; otp?: string | null } = {}): Promise<LoginResult> {
  const [row] = await db<AdminRow[]>`select * from public.admin_users where lower(email) = ${email.trim().toLowerCase()}`;
  if (!row) {
    await verifyPassword(password, DUMMY_HASH).catch(() => false); // equalize timing
    return { ok: false, reason: "invalid" };
  }
  if (row.locked_until && row.locked_until > new Date()) return { ok: false, reason: "locked" };
  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    await countFailure(db, row.id);
    return { ok: false, reason: "invalid" };
  }
  if (!row.is_active) return { ok: false, reason: "inactive" };
  if (row.totp_enabled_at && row.totp_secret_enc) {
    if (!meta.otp?.trim()) return { ok: false, reason: "mfa_required" };
    const second = await verifySecondFactor(db, row, meta.otp);
    if (second === "unavailable") return { ok: false, reason: "mfa_unavailable" };
    if (second === "invalid") {
      await countFailure(db, row.id);
      return { ok: false, reason: "mfa_invalid" };
    }
  }

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

// ── Two-factor enrolment ───────────────────────────────────────────────────────────────────────────────

export class MfaError extends Error {
  override name = "MfaError";
}

/** Starts (or restarts) enrolment: stores a new encrypted, not-yet-enabled secret and returns it for the app. */
export async function startMfaEnrollment(db: Db, adminUserId: string): Promise<{ secret: string }> {
  const key = mfaKey();
  if (!key) throw new MfaError("Two-factor sign-in is not available yet: the server has no ADMIN_MFA_KEY (32+ random characters).");
  const [row] = await db<{ totp_enabled_at: Date | null }[]>`select totp_enabled_at from public.admin_users where id = ${adminUserId}`;
  if (!row) throw new MfaError("Admin not found");
  if (row.totp_enabled_at) throw new MfaError("Two-factor sign-in is already on. Turn it off first to set up a new device.");
  const secret = newTotpSecret();
  await db`update public.admin_users set totp_secret_enc = ${encryptSecret(secret, key)}, totp_last_step = null where id = ${adminUserId}`;
  return { secret };
}

/** Confirms enrolment with a code from the app; returns the recovery codes (shown once, stored hashed). */
export async function confirmMfaEnrollment(db: Db, adminUserId: string, code: string): Promise<{ recoveryCodes: string[] }> {
  const key = mfaKey();
  if (!key) throw new MfaError("ADMIN_MFA_KEY is not configured.");
  const [row] = await db<{ totp_secret_enc: string | null; totp_enabled_at: Date | null }[]>`
    select totp_secret_enc, totp_enabled_at from public.admin_users where id = ${adminUserId}`;
  if (!row?.totp_secret_enc) throw new MfaError("Start the set-up first.");
  if (row.totp_enabled_at) throw new MfaError("Two-factor sign-in is already on.");
  let secret: string;
  try {
    secret = decryptSecret(row.totp_secret_enc, key);
  } catch {
    throw new MfaError("The set-up expired (server key changed). Start again.");
  }
  const step = verifyTotp(secret, code);
  if (step === null) throw new MfaError("That code is not right. Check the time on your phone and try the newest code.");
  const recoveryCodes = newRecoveryCodes();
  await db`update public.admin_users set totp_enabled_at = now(), totp_last_step = ${step},
             totp_recovery_hashes = ${recoveryCodes.map(hashRecoveryCode)} where id = ${adminUserId}`;
  return { recoveryCodes };
}

const CLEAR_MFA = { totp_secret_enc: null, totp_enabled_at: null, totp_last_step: null };

/** Turns two-factor off after re-checking the password and a current code (or a recovery code). */
export async function disableMfa(db: Db, adminUserId: string, password: string, code: string): Promise<void> {
  const [row] = await db<AdminRow[]>`select * from public.admin_users where id = ${adminUserId}`;
  if (!row) throw new MfaError("Admin not found");
  if (!(await verifyPassword(password, row.password_hash))) throw new MfaError("Password is incorrect.");
  if (row.totp_enabled_at) {
    const second = await verifySecondFactor(db, row, code);
    if (second !== "ok") throw new MfaError(second === "unavailable" ? "Two-factor can't be checked (server key changed). Ask the owner to run the reset tool." : "That code is not right.");
  }
  await db`update public.admin_users set ${db(CLEAR_MFA)}, totp_recovery_hashes = ${[] as string[]} where id = ${adminUserId}`;
}

/** Owner recovery (CLI with database access): removes two-factor from an account and signs it out everywhere. */
export async function resetMfa(db: Db, adminUserId: string): Promise<void> {
  await db`update public.admin_users set ${db(CLEAR_MFA)}, totp_recovery_hashes = ${[] as string[]} where id = ${adminUserId}`;
  await revokeAllSessions(db, adminUserId);
}

export async function recoveryCodesLeft(db: Db, adminUserId: string): Promise<number> {
  const [row] = await db<{ n: number }[]>`select coalesce(array_length(totp_recovery_hashes, 1), 0) as n from public.admin_users where id = ${adminUserId}`;
  return Number(row?.n ?? 0);
}

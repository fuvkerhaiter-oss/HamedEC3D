/**
 * Admin two-factor authentication: RFC 6238 TOTP (HMAC-SHA1, 30 s, 6 digits; what Google Authenticator, 1Password,
 * Authy, Microsoft Authenticator use), secrets encrypted at rest with AES-256-GCM (key from ADMIN_MFA_KEY), and
 * single-use recovery codes stored only as sha256 hashes. Pure functions (unit tested), no new dependency.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous and next 30-s step too (clock drift). */
export const TOTP_WINDOW = 1;
export const RECOVERY_CODE_COUNT = 8;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** New 160-bit secret, base32 (the format authenticator apps expect). */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function timeStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_S);
}

/** HOTP value for one time step (RFC 4226 dynamic truncation). */
export function totpAt(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secretB32)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Verifies a 6-digit code. Returns the matched time step, or null. `lastStep` (the last accepted step) blocks replay:
 * a code is accepted at most once, and never one older than the last accepted.
 */
export function verifyTotp(secretB32: string, code: string, opts: { nowMs?: number; lastStep?: number | null } = {}): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const now = timeStep(opts.nowMs);
  let match: number | null = null;
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d++) {
    const step = now + d;
    if (safeEqual(totpAt(secretB32, step), c)) match = step; // no early exit: constant work per call
  }
  if (match === null) return null;
  if (opts.lastStep != null && match <= opts.lastStep) return null;
  return match;
}

/** otpauth:// URI for the authenticator app (manual key entry works too). */
export function otpauthUri(secretB32: string, account: string, issuer = "WEGO SHIIIP Admin"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_S}`;
}

// ── Secret encryption ──────────────────────────────────────────────────────────────────────────────────

/** Null when ADMIN_MFA_KEY is missing/too short: enrolment is then refused (never stored in plain text). */
export function mfaKey(env: Partial<NodeJS.ProcessEnv> = process.env): Buffer | null {
  const k = env.ADMIN_MFA_KEY ?? "";
  return k.length >= 32 ? createHash("sha256").update(`admin-mfa:v1:${k}`).digest() : null;
}

export function encryptSecret(secretB32: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(secretB32, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(stored: string, key: Buffer): string {
  const [v, iv, tag, enc] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Unknown MFA secret format");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}

// ── Recovery codes ─────────────────────────────────────────────────────────────────────────────────────

/** "abcd-efgh-ijkl" style codes (60 bits each), shown once. */
export function newRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => {
    const bytes = randomBytes(12);
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(`admin-recovery:v1:${code.trim().toLowerCase().replace(/\s/g, "")}`).digest("hex");
}

/** Index of the matching recovery hash, or -1. */
export function matchRecoveryCode(code: string, hashes: readonly string[]): number {
  const h = hashRecoveryCode(code);
  let found = -1;
  hashes.forEach((x, i) => {
    if (safeEqual(x, h)) found = i;
  });
  return found;
}

/** Whether the deployment requires MFA for this role (ADMIN_REQUIRE_MFA = "super_admin" | "all"; default: none). */
export function mfaRequiredFor(role: string, env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  const v = (env.ADMIN_REQUIRE_MFA ?? "").trim().toLowerCase();
  if (v === "all") return true;
  if (v === "super_admin") return role === "SUPER_ADMIN";
  return false;
}

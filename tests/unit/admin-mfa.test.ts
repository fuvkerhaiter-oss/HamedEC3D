import assert from "node:assert/strict";
import { test } from "node:test";
import {
  base32Decode, base32Encode, decryptSecret, encryptSecret, hashRecoveryCode, matchRecoveryCode, mfaKey, mfaRequiredFor,
  newRecoveryCodes, newTotpSecret, otpauthUri, timeStep, totpAt, verifyTotp,
} from "../../src/lib/admin/totp";

// RFC 6238 appendix B, SHA-1 seed "12345678901234567890" (last 6 digits of the 8-digit vectors).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("RFC 6238 test vectors", () => {
  assert.equal(RFC_SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(totpAt(RFC_SECRET, timeStep(59_000)), "287082");
  assert.equal(totpAt(RFC_SECRET, timeStep(1111111109_000)), "081804");
  assert.equal(totpAt(RFC_SECRET, timeStep(1234567890_000)), "005924");
  assert.equal(totpAt(RFC_SECRET, timeStep(2000000000_000)), "279037");
  assert.deepEqual(base32Decode(RFC_SECRET), Buffer.from("12345678901234567890"));
});

test("verify: ±1 step drift accepted, older/replayed codes refused, junk refused", () => {
  const s = newTotpSecret();
  const now = 1_800_000_000_000;
  const step = timeStep(now);
  assert.equal(verifyTotp(s, totpAt(s, step), { nowMs: now }), step);
  assert.equal(verifyTotp(s, totpAt(s, step - 1), { nowMs: now }), step - 1);
  assert.equal(verifyTotp(s, totpAt(s, step + 1), { nowMs: now }), step + 1);
  assert.equal(verifyTotp(s, totpAt(s, step - 2), { nowMs: now }), null, "too old");
  assert.equal(verifyTotp(s, totpAt(s, step), { nowMs: now, lastStep: step }), null, "replay of the same step");
  assert.equal(verifyTotp(s, totpAt(s, step - 1), { nowMs: now, lastStep: step }), null, "older than last accepted");
  for (const junk of ["", "12345", "abcdef", "1234567"]) assert.equal(verifyTotp(s, junk, { nowMs: now }), null);
  const code = totpAt(s, step);
  assert.equal(verifyTotp(s, `${code.slice(0, 3)} ${code.slice(3)}`, { nowMs: now }), step, "spaces allowed");
});

test("secrets are encrypted (AES-GCM) and need ADMIN_MFA_KEY ≥ 32 chars; tampering fails", () => {
  assert.equal(mfaKey({}), null);
  assert.equal(mfaKey({ ADMIN_MFA_KEY: "short" }), null);
  const key = mfaKey({ ADMIN_MFA_KEY: "x".repeat(40) })!;
  const s = newTotpSecret();
  const enc = encryptSecret(s, key);
  assert.ok(!enc.includes(s));
  assert.equal(decryptSecret(enc, key), s);
  assert.throws(() => decryptSecret(enc, mfaKey({ ADMIN_MFA_KEY: "y".repeat(40) })!));
  const parts = enc.split(".");
  const bytes = Buffer.from(parts[3]!, "base64url");
  bytes[0] = bytes[0]! ^ 0xff; // flip a real ciphertext byte (editing trailing base64 chars may only touch padding bits)
  parts[3] = bytes.toString("base64url");
  assert.throws(() => decryptSecret(parts.join("."), key));
});

test("recovery codes: unique, hashed, matched case/space-insensitively", () => {
  const codes = newRecoveryCodes();
  assert.equal(new Set(codes).size, 8);
  const hashes = codes.map(hashRecoveryCode);
  assert.ok(hashes.every((h) => /^[0-9a-f]{64}$/.test(h)));
  assert.equal(matchRecoveryCode(` ${codes[3]!.toUpperCase()} `, hashes), 3);
  assert.equal(matchRecoveryCode("aaaa-bbbb-cccc", hashes), -1);
});

test("policy and otpauth URI", () => {
  assert.equal(mfaRequiredFor("SUPER_ADMIN", {}), false, "off by default: no lockout on deploy");
  assert.equal(mfaRequiredFor("SUPER_ADMIN", { ADMIN_REQUIRE_MFA: "super_admin" }), true);
  assert.equal(mfaRequiredFor("SUPPORT", { ADMIN_REQUIRE_MFA: "super_admin" }), false);
  assert.equal(mfaRequiredFor("SUPPORT", { ADMIN_REQUIRE_MFA: "all" }), true);
  assert.match(otpauthUri("ABC", "a@b.test"), /^otpauth:\/\/totp\/WEGO%20SHIIIP%20Admin%3Aa%40b\.test\?secret=ABC&issuer=WEGO%20SHIIIP%20Admin/);
});

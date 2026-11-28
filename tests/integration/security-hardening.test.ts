import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { confirmMfaEnrollment, disableMfa, getSessionAdmin, login, recoveryCodesLeft, resetMfa, startMfaEnrollment } from "../../src/lib/admin/auth";
import { timeStep, totpAt } from "../../src/lib/admin/totp";
import { purgeRateLimitBuckets, rateLimitedShared, sharedHit } from "../../src/lib/rate-limit";
import { makeAdmin, startTestDb, TEST_PASSWORD, type TestDb } from "./helpers";

let t: TestDb;
const prevKey = process.env.ADMIN_MFA_KEY;
before(async () => {
  process.env.ADMIN_MFA_KEY = "integration-test-mfa-key-0123456789abcdef";
  t = await startTestDb("security");
});
after(async () => {
  process.env.ADMIN_MFA_KEY = prevKey;
  await t.close();
});

test("two-factor: enrol, password alone is refused, code signs in, replay and wrong codes fail, recovery code works once", async () => {
  const admin = await makeAdmin(t.sql, "SUPER_ADMIN", "mfa@test.local");
  const id = admin.id;
  const { secret } = await startMfaEnrollment(t.sql, id);
  const [stored] = await t.sql<{ totp_secret_enc: string }[]>`select totp_secret_enc from public.admin_users where id = ${id}`;
  assert.ok(!stored!.totp_secret_enc.includes(secret), "secret is encrypted at rest");
  assert.ok((await login(t.sql, "mfa@test.local", TEST_PASSWORD)).ok, "not enforced until confirmed");

  await assert.rejects(confirmMfaEnrollment(t.sql, id, "000000"));
  const enrolStep = timeStep() - 1; // a code from the previous step: leaves the current one for the sign-in below
  const { recoveryCodes } = await confirmMfaEnrollment(t.sql, id, totpAt(secret, enrolStep));
  assert.equal(recoveryCodes.length, 8);
  assert.equal(await recoveryCodesLeft(t.sql, id), 8);

  const noCode = await login(t.sql, "mfa@test.local", TEST_PASSWORD);
  assert.deepEqual(noCode, { ok: false, reason: "mfa_required" });
  assert.deepEqual(await login(t.sql, "mfa@test.local", TEST_PASSWORD, { otp: "111111" }), { ok: false, reason: "mfa_invalid" });

  const code = totpAt(secret, timeStep());
  const ok = await login(t.sql, "mfa@test.local", TEST_PASSWORD, { otp: code });
  assert.ok(ok.ok);
  assert.equal((await getSessionAdmin(t.sql, ok.ok ? ok.token : ""))?.user.mfaEnabled, true);
  assert.deepEqual(await login(t.sql, "mfa@test.local", TEST_PASSWORD, { otp: code }), { ok: false, reason: "mfa_invalid" }, "replay refused");

  assert.ok((await login(t.sql, "mfa@test.local", TEST_PASSWORD, { otp: recoveryCodes[0]! })).ok);
  assert.equal(await recoveryCodesLeft(t.sql, id), 7);
  assert.deepEqual(await login(t.sql, "mfa@test.local", TEST_PASSWORD, { otp: recoveryCodes[0]! }), { ok: false, reason: "mfa_invalid" }, "recovery code is single-use");
  assert.equal((await login(t.sql, "mfa@test.local", "wrong-password-123", { otp: recoveryCodes[1]! })).ok, false, "a code never replaces the password");
  assert.equal(await recoveryCodesLeft(t.sql, id), 7, "a refused password does not burn a recovery code");

  await assert.rejects(disableMfa(t.sql, id, "wrong-password-123", recoveryCodes[2]!));
  await disableMfa(t.sql, id, TEST_PASSWORD, recoveryCodes[2]!);
  assert.ok((await login(t.sql, "mfa@test.local", TEST_PASSWORD)).ok, "off again");

  await startMfaEnrollment(t.sql, id);
  await resetMfa(t.sql, id);
  const [row] = await t.sql<{ totp_secret_enc: string | null }[]>`select totp_secret_enc from public.admin_users where id = ${id}`;
  assert.equal(row!.totp_secret_enc, null);
});

test("enrolment is refused without ADMIN_MFA_KEY (secrets are never stored in plain text)", async () => {
  const admin = await makeAdmin(t.sql, "ADMIN", "nokey@test.local");
  const id = admin.id;
  const k = process.env.ADMIN_MFA_KEY;
  delete process.env.ADMIN_MFA_KEY;
  try {
    await assert.rejects(startMfaEnrollment(t.sql, id), /ADMIN_MFA_KEY/);
  } finally {
    process.env.ADMIN_MFA_KEY = k;
  }
});

test("shared rate limit counts across instances (same DB), stores only hashes, and purges old windows", async () => {
  const key = `otp-send:203.0.113.${Math.floor(Math.random() * 200)}`;
  const now = Date.now();
  // Simulate two server instances: the memory layer of "this" instance sees 1 hit; the DB sees all of them.
  for (let i = 0; i < 4; i++) await sharedHit(t.sql, key, 60_000, now);
  assert.equal(await rateLimitedShared(key, 5, 60_000, { db: t.sql, now }), false, "5th hit allowed");
  assert.equal(await rateLimitedShared(key, 5, 60_000, { db: t.sql, now }), true, "6th hit blocked although this instance only saw 2");
  const rows = await t.sql<{ key_hash: string }[]>`select key_hash from public.rate_limit_buckets`;
  assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.key_hash) && !r.key_hash.includes("203.0.113")));
  await t.sql`update public.rate_limit_buckets set window_start = now() - interval '2 days'`;
  assert.ok((await purgeRateLimitBuckets(t.sql)) >= 1);
});

test("browser roles can read published CMS pages but never unpublished draft text", async () => {
  await t.sql`insert into public.cms_pages (slug, title, draft_body, published_body, status, published_at)
              values ('draft-leak-test', 'Terms', 'SECRET DRAFT', 'Public text', 'published', now())`;
  await t.sql.begin(async (tx) => {
    await tx`set local role anon`;
    const [row] = await tx<{ published_body: string }[]>`select published_body from public.cms_pages where slug = 'draft-leak-test'`;
    assert.equal(row?.published_body, "Public text");
  });
  await assert.rejects(
    t.sql.begin(async (tx) => {
      await tx`set local role anon`;
      await tx`select draft_body from public.cms_pages`;
    }),
    /permission denied/,
  );
});

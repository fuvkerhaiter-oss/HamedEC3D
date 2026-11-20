import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { getSessionAdmin, login, MAX_FAILED_LOGINS, revokeSession } from "../../src/lib/admin/auth";
import { logActivity } from "../../src/lib/admin/audit";
import { updateAdmin, inviteAdmin } from "../../src/lib/admin/services/people";
import { makeAdmin, startTestDb, TEST_PASSWORD, type TestDb } from "./helpers";

let t: TestDb;
before(async () => (t = await startTestDb("auth")));
after(() => t.close());

test("login creates a hashed session; role permissions are enforced", async () => {
  await makeAdmin(t.sql, "SUPPORT", "support@test.local");
  const res = await login(t.sql, "Support@Test.local", TEST_PASSWORD, { ip: "1.2.3.4" });
  assert.ok(res.ok);
  const [stored] = await t.sql<{ token_hash: string }[]>`select token_hash from public.admin_sessions`;
  assert.notEqual(stored!.token_hash, res.token, "raw token is never stored");
  const s = await getSessionAdmin(t.sql, res.token);
  assert.equal(s?.user.role, "SUPPORT");
  assert.ok(s!.permissions.has("orders.view"));
  assert.ok(!s!.permissions.has("products.edit"), "support cannot edit products");
  assert.ok(!s!.permissions.has("orders.refund"), "support cannot refund");
  assert.ok(!s!.permissions.has("admins.manage"));
  await revokeSession(t.sql, res.token);
  assert.equal(await getSessionAdmin(t.sql, res.token), null, "logout revokes the session");
  assert.equal(await getSessionAdmin(t.sql, "forged-token"), null);
});

test("wrong passwords lock the account; unknown emails look the same", async () => {
  await makeAdmin(t.sql, "ADMIN", "lock@test.local");
  for (let i = 0; i < MAX_FAILED_LOGINS; i++) assert.deepEqual(await login(t.sql, "lock@test.local", "wrong-password-1"), { ok: false, reason: "invalid" });
  assert.deepEqual(await login(t.sql, "lock@test.local", TEST_PASSWORD), { ok: false, reason: "locked" }, "even the right password is refused while locked");
  assert.deepEqual(await login(t.sql, "nobody@test.local", TEST_PASSWORD), { ok: false, reason: "invalid" });
});

test("deactivating an admin kills their sessions; last super admin is protected", async () => {
  const sup = await makeAdmin(t.sql, "SUPER_ADMIN", "root@test.local");
  const pm = await inviteAdmin(t.sql, sup, { email: "pm@test.local", fullName: "PM", role: "PRODUCT_MANAGER", password: TEST_PASSWORD });
  const r = await login(t.sql, "pm@test.local", TEST_PASSWORD);
  assert.ok(r.ok);
  await updateAdmin(t.sql, sup, { id: pm.id, role: "PRODUCT_MANAGER", isActive: false, extra: [], revoked: [], fullName: "PM" });
  assert.equal(await getSessionAdmin(t.sql, r.token), null);
  assert.deepEqual(await login(t.sql, "pm@test.local", TEST_PASSWORD), { ok: false, reason: "inactive" });
  await assert.rejects(updateAdmin(t.sql, sup, { id: sup.id, role: "ADMIN", isActive: true, extra: [], revoked: [], fullName: "" }), /own role/);
  const admin = await makeAdmin(t.sql, "ADMIN", "notsuper@test.local");
  await assert.rejects(inviteAdmin(t.sql, admin, { email: "x@test.local", fullName: "", role: "SUPER_ADMIN", password: TEST_PASSWORD }), /super admin/);
});

test("granular overrides: extra and revoked permissions", async () => {
  const sup = await makeAdmin(t.sql, "SUPER_ADMIN", "root2@test.local");
  const om = await makeAdmin(t.sql, "ORDER_MANAGER", "om@test.local");
  await updateAdmin(t.sql, sup, { id: om.id, role: "ORDER_MANAGER", isActive: true, extra: ["products.edit", "admins.manage"], revoked: ["orders.refund"], fullName: "" });
  const r = await login(t.sql, "om@test.local", TEST_PASSWORD);
  assert.ok(r.ok);
  const s = await getSessionAdmin(t.sql, r.token);
  assert.ok(s!.permissions.has("products.edit"));
  assert.ok(!s!.permissions.has("orders.refund"));
  assert.ok(!s!.permissions.has("admins.manage"), "admins.manage can never be granted as an extra");
});

test("activity log is append-only", async () => {
  await logActivity(t.sql, null, { action: "test", entity: "x", summary: "hello" });
  await assert.rejects(t.sql`update public.admin_activity_log set summary = 'tampered'`, /append-only/);
  await assert.rejects(t.sql`delete from public.admin_activity_log`, /append-only/);
});

test("admin tables are invisible to browser roles (RLS, no policies)", async () => {
  await t.sql.begin(async (tx) => {
    await tx`set local role anon`;
    const rows = await tx`select * from public.admin_users`;
    assert.equal(rows.length, 0);
    const sessions = await tx`select * from public.admin_sessions`;
    assert.equal(sessions.length, 0);
  });
});

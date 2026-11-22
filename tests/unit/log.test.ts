import { test } from "node:test";
import assert from "node:assert/strict";
import { isDbUnreachable, logFallback } from "../../src/lib/log";

test("unreachable database (dev) is one warning; real query errors stay errors", () => {
  const warn: string[] = [];
  const error: string[] = [];
  const [w, e] = [console.warn, console.error];
  console.warn = (...a: unknown[]) => void warn.push(a.join(" "));
  console.error = (...a: unknown[]) => void error.push(a.join(" "));
  try {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:54329"), { code: "ECONNREFUSED" });
    assert.equal(isDbUnreachable(refused), true);
    assert.equal(isDbUnreachable({ errors: [{ code: "ECONNREFUSED" }] }), true, "AggregateError (IPv4 + IPv6)");
    assert.equal(isDbUnreachable({ code: "ENETUNREACH" }), true, "IPv6-only host on Vercel");
    assert.equal(isDbUnreachable(Object.assign(new Error("relation missing"), { code: "42P01" })), false);
    logFallback("test-label", refused);
    logFallback("test-label", refused);
    assert.equal(warn.length, 1, "warned once per label");
    assert.match(warn[0]!, /npm run db:local/);
    logFallback("test-label", Object.assign(new Error("bad sql"), { code: "42601" }));
    assert.equal(error.length, 1, "query errors are still errors");
  } finally {
    console.warn = w;
    console.error = e;
  }
});

test("Vercel ↔ Supabase integration: POSTGRES_URL (IPv4 pooler) replaces an IPv6-only direct DATABASE_URL", async () => {
  const { databaseUrl } = await import("../../src/lib/db/client");
  const direct = "postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres";
  const pooled = "postgres://postgres.abcdefgh:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x";
  const cleaned = "postgres://postgres.abcdefgh:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require";
  assert.equal(databaseUrl({ DATABASE_URL: direct, POSTGRES_URL: pooled }), cleaned);
  assert.equal(databaseUrl({ POSTGRES_URL: pooled }), cleaned, "integration only, no DATABASE_URL");
  assert.equal(databaseUrl({ DATABASE_URL: "postgres://u:p@127.0.0.1:54329/x", POSTGRES_URL: pooled }), "postgres://u:p@127.0.0.1:54329/x", "explicit non-direct URL wins");
  assert.equal(databaseUrl({ DATABASE_URL: direct }), direct, "nothing better available: keep it (and log the hint)");
  assert.equal(databaseUrl({}), undefined);
  assert.equal(databaseUrl({ VERCEL: "1", DATABASE_URL: "postgres://wrong:pw@aws-0-x.pooler.supabase.com:6543/postgres", POSTGRES_URL: pooled }), cleaned, "on Vercel the integration wins");
});

test("a refused connection (pooler FATAL / auth / missing db) counts as unreachable; query errors do not", async () => {
  const { isDbUnreachable } = await import("../../src/lib/log");
  assert.equal(isDbUnreachable({ code: "XX000", severity_local: "FATAL", message: "Tenant or user not found" }), true);
  assert.equal(isDbUnreachable({ code: "28P01", severity: "FATAL" }), true);
  assert.equal(isDbUnreachable({ code: "3D000" }), true);
  assert.equal(isDbUnreachable({ code: "XX000", severity: "ERROR" }), false);
  assert.equal(isDbUnreachable({ code: "23505", severity: "ERROR" }), false);
});

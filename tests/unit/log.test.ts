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

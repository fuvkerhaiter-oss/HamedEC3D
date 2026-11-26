import { test } from "node:test";
import assert from "node:assert/strict";
import { baseSecurityHeaders, contentSecurityPolicy, isCrossSiteRequest } from "../../src/lib/security/headers";
import { clientIp, rateLimited } from "../../src/lib/rate-limit";

const prod = { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" };

test("CSP: production policy locks down scripts, framing, plugins and form targets", () => {
  const csp = contentSecurityPolicy(prod);
  for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "upgrade-insecure-requests"]) assert.ok(csp.includes(d), d);
  assert.match(csp, /connect-src [^;]*https:\/\/abc\.supabase\.co [^;]*wss:\/\/abc\.supabase\.co/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  assert.doesNotMatch(csp, /script-src[^;]*https:/, "no external script hosts");
  assert.ok(contentSecurityPolicy({ NODE_ENV: "development" }).includes("'unsafe-eval'"), "dev keeps HMR working");
});

test("headers: HSTS only in production, framing denied", () => {
  const keys = (env: Record<string, string>) => baseSecurityHeaders(env).map((h) => h.key);
  assert.ok(keys(prod).includes("Strict-Transport-Security"));
  assert.ok(!keys({ NODE_ENV: "development" }).includes("Strict-Transport-Security"));
  assert.equal(baseSecurityHeaders(prod).find((h) => h.key === "X-Frame-Options")?.value, "DENY");
});

test("CSRF guard: refuses cross-site writes, allows same-origin, reads and signed machine calls", () => {
  const h = (o: Record<string, string>) => new Headers({ host: "shop.test", ...o });
  assert.equal(isCrossSiteRequest("POST", "/api/account/delete", h({ origin: "https://evil.example" })), true);
  assert.equal(isCrossSiteRequest("POST", "/api/account/delete", h({ origin: "null" })), true);
  assert.equal(isCrossSiteRequest("DELETE", "/api/account/addresses/x", h({ "sec-fetch-site": "cross-site" })), true);
  assert.equal(isCrossSiteRequest("POST", "/api/account/delete", h({ origin: "https://shop.test" })), false);
  assert.equal(isCrossSiteRequest("GET", "/api/cart/sync", h({ origin: "https://evil.example" })), false);
  assert.equal(isCrossSiteRequest("POST", "/api/webhooks/stripe", h({ origin: "https://evil.example" })), false);
  assert.equal(isCrossSiteRequest("POST", "/api/cron/fulfillment", h({})), false);
  assert.equal(isCrossSiteRequest("POST", "/api/contact", h({})), false, "non-browser client without cookies");
  assert.equal(isCrossSiteRequest("POST", "/x", new Headers({ host: "shop.test", "x-forwarded-host": "www.shop.test", origin: "https://www.shop.test" })), false);
});

test("rate limiter: blocks over the limit, window slides, key count stays bounded", () => {
  const k = `t-${Math.random()}`;
  for (let i = 0; i < 3; i++) assert.equal(rateLimited(k, 3, 1000, 10), false);
  assert.equal(rateLimited(k, 3, 1000, 10), true);
  assert.equal(rateLimited(k, 3, 1000, 2000), false);
  for (let i = 0; i < 25_000; i++) rateLimited(`flood-${i}`, 1, 60_000, 5000);
  assert.equal(rateLimited(`flood-24999`, 1, 60_000, 5000), true, "recent keys survive the cap");
});

test("clientIp prefers platform headers and caps length", () => {
  assert.equal(clientIp(new Request("http://x", { headers: { "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" } })), "1.2.3.4");
  assert.equal(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "5.6.7.8, 10.0.0.1" } })), "5.6.7.8");
  assert.equal(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "a".repeat(500) } })).length, 64);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeRedirect } from "../../src/app/auth/callback/route";
import { authOtpEmail } from "../../src/lib/email/templates";

test("redirect sanitization: allows safe local paths", () => {
  assert.equal(sanitizeRedirect("/"), "/");
  assert.equal(sanitizeRedirect("/account"), "/account");
  assert.equal(sanitizeRedirect("/checkout"), "/checkout");
  assert.equal(sanitizeRedirect("/order?id=123&t=abc"), "/order?id=123&t=abc");
  assert.equal(sanitizeRedirect("/catalog?market=EU"), "/catalog?market=EU");
});

test("redirect sanitization: rejects external and open redirect vectors", () => {
  // Protocol-relative URLs
  assert.equal(sanitizeRedirect("//evil.com"), "/account");
  assert.equal(sanitizeRedirect("///evil.com"), "/account");
  // Absolute URLs
  assert.equal(sanitizeRedirect("https://evil.com"), "/account");
  assert.equal(sanitizeRedirect("http://evil.com/phish"), "/account");
  // Backslash / Windows bypasses
  assert.equal(sanitizeRedirect("/\\evil.com"), "/account");
  assert.equal(sanitizeRedirect("\\evil.com"), "/account");
  // Javascript / data schemes
  assert.equal(sanitizeRedirect("javascript:alert(1)"), "/account");
  assert.equal(sanitizeRedirect("data:text/html,evil"), "/account");
  // Null and empty values fallback safely
  assert.equal(sanitizeRedirect(null), "/account");
  assert.equal(sanitizeRedirect(undefined), "/account");
  assert.equal(sanitizeRedirect(""), "/account");
  assert.equal(sanitizeRedirect("   "), "/account");
});

test("redirect sanitization: custom fallback path", () => {
  assert.equal(sanitizeRedirect("https://evil.com", "/checkout"), "/checkout");
  assert.equal(sanitizeRedirect(null, "/store"), "/store");
});

test("OTP email template formatting and security", () => {
  const code = "839201";
  const email = authOtpEmail(code, 45);

  assert.match(email.subject, /839201/, "subject includes the OTP code");
  assert.match(email.text, /839201/, "text body includes the OTP code");
  assert.match(email.text, /45 minutes/, "text body mentions configured expiration");
  assert.match(email.html, /WEGO.*SHIIIP/, "branding is present in html");
  assert.doesNotMatch(email.html, /<script>/i, "no raw script tags");
});

/**
 * Production configuration check. Reports problems by variable NAME only — values are never printed.
 * Run: `npm run check:env` (loads .env.local) or in the deployment environment.
 */
export interface ConfigIssue {
  level: "error" | "warn";
  key: string;
  problem: string;
}

export function checkProductionConfig(env: NodeJS.ProcessEnv): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const err = (key: string, problem: string) => out.push({ level: "error", key, problem });
  const warn = (key: string, problem: string) => out.push({ level: "warn", key, problem });
  const v = (k: string) => (env[k] ?? "").trim();

  const site = v("NEXT_PUBLIC_SITE_URL");
  if (!site) err("NEXT_PUBLIC_SITE_URL", "missing (payment redirects and email links need it)");
  else if (!site.startsWith("https://")) err("NEXT_PUBLIC_SITE_URL", "must be an https:// URL in production");
  if (!v("DATABASE_URL")) err("DATABASE_URL", "missing");
  else if (/@(127\.0\.0\.1|localhost)[:/]/.test(v("DATABASE_URL"))) err("DATABASE_URL", "points at a local database");
  if (v("ORDER_LINK_SECRET").length < 32) err("ORDER_LINK_SECRET", "must be 32+ random characters");
  if (v("CRON_SECRET").length < 16) err("CRON_SECRET", "must be 16+ random characters (cron jobs refuse otherwise)");

  const sk = v("STRIPE_SECRET_KEY");
  if (!sk) err("STRIPE_SECRET_KEY", "missing — checkout cannot take payments");
  else {
    const live = sk.startsWith("sk_live_") || sk.startsWith("rk_live_");
    if (live && v("STRIPE_ALLOW_LIVE") !== "true") err("STRIPE_ALLOW_LIVE", "live key set but live payments are not enabled (set to true only after Stripe test-mode verification)");
    if (!live) warn("STRIPE_SECRET_KEY", "test-mode key: no real money will be taken");
  }
  if (!v("STRIPE_WEBHOOK_SECRET").startsWith("whsec_")) err("STRIPE_WEBHOOK_SECRET", "missing or not a whsec_ secret — payments can never be confirmed");
  const pk = v("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  if (pk && sk && pk.includes("_live_") !== sk.includes("_live_")) err("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "test/live mode differs from STRIPE_SECRET_KEY");
  if (v("PAYMENT_PROVIDER") === "dev-simulator") err("PAYMENT_PROVIDER", "dev-simulator is development only");
  if (v("DEV_PAYMENT_WEBHOOK_SECRET")) warn("DEV_PAYMENT_WEBHOOK_SECRET", "set in production (unused there; remove it)");

  const ae = ["ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET", "ALIEXPRESS_ACCESS_TOKEN"].filter((k) => v(k));
  if (ae.length && ae.length < 3) err("ALIEXPRESS_APP_KEY", "AliExpress credentials incomplete — need ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET and ALIEXPRESS_ACCESS_TOKEN");
  if (Object.keys(env).some((k) => k.startsWith("NEXT_PUBLIC_") && /ALIEXPRESS|ALIBABA|SUPPLIER/i.test(k))) err("NEXT_PUBLIC_*", "supplier credentials must never be NEXT_PUBLIC_ (they would reach the browser)");
  if (!v("RESEND_API_KEY")) warn("RESEND_API_KEY", "missing — customer emails are recorded but NOT sent");
  if (!v("EMAIL_FROM")) warn("EMAIL_FROM", "missing — needs an address on a domain verified in Resend");
  if (!v("SUPPORT_EMAIL")) warn("SUPPORT_EMAIL", "missing — contact-form messages only reach the admin panel");
  if (!v("NEXT_PUBLIC_SUPABASE_URL") || !v("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")) warn("NEXT_PUBLIC_SUPABASE_URL", "Supabase URL/publishable key missing (customer authentication, product images storage, 3D rooms)");
  if (!v("SUPABASE_SECRET_KEY")) warn("SUPABASE_SECRET_KEY", "missing — product image uploads disabled");

  // Hardening (2026-11-28).
  if (v("ADMIN_MFA_KEY").length < 32) warn("ADMIN_MFA_KEY", "missing/short — admins cannot turn on two-factor sign-in (32+ random characters)");
  const reqMfa = v("ADMIN_REQUIRE_MFA").toLowerCase();
  if (reqMfa && !["all", "super_admin"].includes(reqMfa)) err("ADMIN_REQUIRE_MFA", "must be 'super_admin' or 'all' (or unset)");
  if (reqMfa && v("ADMIN_MFA_KEY").length < 32) err("ADMIN_REQUIRE_MFA", "requires ADMIN_MFA_KEY, otherwise admins could never enrol");
  if (!reqMfa) warn("ADMIN_REQUIRE_MFA", "not set — two-factor is optional for admins (recommended: super_admin once enrolled)");
  if (!v("OPS_ALERT_WEBHOOK_URL")) warn("OPS_ALERT_WEBHOOK_URL", "missing — server errors (checkout, webhooks, cron) only reach the Vercel logs");
  else if (!v("OPS_ALERT_WEBHOOK_URL").startsWith("https://")) err("OPS_ALERT_WEBHOOK_URL", "must be an https:// webhook URL");
  if (v("SHOW_SAMPLE_PRODUCTS") === "true") err("SHOW_SAMPLE_PRODUCTS", "sample products would be shown and sold as real products");
  if (v("NEXT_PUBLIC_MULTIPLAYER") === "on" && !v("NEXT_PUBLIC_TURN_URL")) warn("NEXT_PUBLIC_MULTIPLAYER", "on without a TURN relay: voice fails behind strict NATs and peers see each other's IP");
  if (v("VISITOR_LOG_FULL_IP") === "true") warn("VISITOR_LOG_FULL_IP", "full IP addresses are stored: needs a documented legal basis and privacy-policy wording");
  if (!v("NEXT_PUBLIC_PLAUSIBLE_DOMAIN")) warn("NEXT_PUBLIC_PLAUSIBLE_DOMAIN", "missing — no conversion analytics (funnel events are dropped)");

  // Secrets must never be exposed through NEXT_PUBLIC_* variables.
  for (const [k, val] of Object.entries(env)) {
    if (!k.startsWith("NEXT_PUBLIC_") || !val) continue;
    if (/^(sk_|rk_)(live|test)_|^whsec_|^sb_secret_|^re_[A-Za-z0-9]{10,}/.test(val) || /SECRET|SERVICE_ROLE|PASSWORD/i.test(k.replace("NEXT_PUBLIC_TURN_CREDENTIAL", ""))) {
      err(k, "looks like a secret in a browser-exposed NEXT_PUBLIC_ variable");
    }
  }
  return out;
}

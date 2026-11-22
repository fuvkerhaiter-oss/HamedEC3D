/**
 * Exchange an AliExpress / Alibaba.com Open Platform OAuth code for an access token and save it to .env.local.
 *   npm run supplier:token -- <code>             (AliExpress, uses ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET)
 *   npm run supplier:token -- <code> --alibaba   (Alibaba.com, uses ALIBABA_APP_KEY / ALIBABA_APP_SECRET)
 *   npm run supplier:token -- --refresh [--alibaba]   (renew with the saved refresh token)
 * Tokens are written to .env.local only, never printed in full.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { iopSignRest } from "../../src/lib/suppliers/aliexpress/iop";

const envPath = path.resolve(import.meta.dirname, "..", "..", ".env.local");
const args = process.argv.slice(2);
const alibaba = args.includes("--alibaba");
const refresh = args.includes("--refresh");
const code = args.find((a) => !a.startsWith("--"));
const P = alibaba ? "ALIBABA" : "ALIEXPRESS";

let env = "";
try { env = readFileSync(envPath, "utf8"); } catch { /* created below */ }
const get = (k: string) => process.env[k] ?? new RegExp(`^${k}=(.*)$`, "m").exec(env)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
const appKey = get(`${P}_APP_KEY`);
const secret = get(`${P}_APP_SECRET`);
if (!appKey || !secret) {
  console.error(`Put ${P}_APP_KEY and ${P}_APP_SECRET in .env.local first (from your app page on the open platform).`);
  process.exit(1);
}
if (!refresh && !code) {
  console.error("Usage: npm run supplier:token -- <code> [--alibaba]   |   npm run supplier:token -- --refresh [--alibaba]");
  process.exit(1);
}
const gateway = get(`${P}_REST_URL`) || (alibaba ? "https://openapi-api.alibaba.com/rest" : "https://api-sg.aliexpress.com/rest");
const apiPath = refresh ? "/auth/token/refresh" : "/auth/token/create";
const params: Record<string, string> = { app_key: appKey, timestamp: String(Date.now()), sign_method: "sha256" };
if (refresh) {
  const rt = get(`${P}_REFRESH_TOKEN`);
  if (!rt) { console.error(`No ${P}_REFRESH_TOKEN in .env.local — authorise again and pass the new code.`); process.exit(1); }
  params.refresh_token = rt;
} else params.code = code!;
params.sign = iopSignRest(apiPath, params, secret);

const res = await fetch(gateway + apiPath, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body: new URLSearchParams(params) });
const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
if (!body.access_token) {
  console.error(`Failed (HTTP ${res.status}): ${String(body.code ?? "")} ${String(body.message ?? "")}`.trim());
  console.error("Codes are single-use and expire after a few minutes: authorise again and run with the new code.");
  process.exit(1);
}
const expiry = (sec: unknown) => (Number(sec) > 0 ? new Date(Date.now() + Number(sec) * 1000).toISOString() : "");
const updates: Record<string, string> = {
  [`${P}_ACCESS_TOKEN`]: String(body.access_token),
  [`${P}_REFRESH_TOKEN`]: String(body.refresh_token ?? get(`${P}_REFRESH_TOKEN`)),
  [`${P}_TOKEN_EXPIRES_AT`]: expiry(body.expires_in),
  [`${P}_REFRESH_EXPIRES_AT`]: expiry(body.refresh_expires_in),
};
for (const [k, v] of Object.entries(updates)) {
  const line = `${k}=${v}`;
  env = new RegExp(`^${k}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${env.replace(/\n?$/, "\n")}${line}\n`;
}
writeFileSync(envPath, env);
const t = updates[`${P}_ACCESS_TOKEN`]!;
console.log(`Saved to .env.local: ${P}_ACCESS_TOKEN=${t.slice(0, 4)}…${t.slice(-4)} (expires ${updates[`${P}_TOKEN_EXPIRES_AT`] || "unknown"}), refresh token saved.`);
console.log(`Account: ${String(body.account ?? body.user_nick ?? "?")}. Add the same values to Vercel → Environment Variables for production.`);

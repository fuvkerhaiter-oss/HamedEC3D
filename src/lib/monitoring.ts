/**
 * Operational alerts without a vendor SDK: in production, logError() also posts a short, PII-free line to
 * OPS_ALERT_WEBHOOK_URL (a Slack or Discord incoming webhook, https only). Same label at most once per 10 minutes per
 * server instance, 3-s timeout, never throws. Best effort: on serverless the request may end before it is sent,
 * so keep Vercel's log alerts / a log drain as the reliable record. Uptime: monitor /api/health from outside.
 */
import { after } from "next/server";
import { safeError } from "./log-safe";

const QUIET_MS = 10 * 60_000;
const lastSent = new Map<string, number>();

export function alertWebhookUrl(env: Partial<NodeJS.ProcessEnv> = process.env): string | null {
  const u = env.OPS_ALERT_WEBHOOK_URL?.trim();
  if (!u) return null;
  try {
    return new URL(u).protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** True when this label should alert now (dedupe window). Exported for tests. */
export function shouldAlert(label: string, now = Date.now()): boolean {
  const last = lastSent.get(label);
  if (last !== undefined && now - last < QUIET_MS) return false;
  lastSent.set(label, now);
  if (lastSent.size > 500) lastSent.delete(lastSent.keys().next().value!);
  return true;
}

export function notifyOps(label: string, e: unknown, env: Partial<NodeJS.ProcessEnv> = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const url = alertWebhookUrl(env);
  if (!url || !shouldAlert(label)) return;
  const err = safeError(e);
  const text = `⚠️ WEGO SHIIIP: ${label} — ${err.name}${err.code ? ` ${err.code}` : ""}: ${err.message}`.slice(0, 900);
  const sent = fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, content: text }), // Slack reads "text", Discord "content"
    signal: AbortSignal.timeout(3000),
  }).then(() => undefined, () => undefined);
  // Inside a request, keep the function alive until the alert is sent (serverless would otherwise freeze it).
  // Outside a request scope (startup, scripts) after() throws: the fetch still runs, best effort.
  try {
    after(sent);
  } catch {
    /* not in a request scope */
  }
}

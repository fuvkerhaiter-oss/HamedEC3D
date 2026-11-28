"use client";
/**
 * Privacy-friendly analytics client. Sends events to Plausible (cookieless, no personal data) through our own
 * domain (/stats/api/event, rewritten in next.config.ts), so no third-party script runs and the CSP stays 'self'.
 * Off unless NEXT_PUBLIC_PLAUSIBLE_DOMAIN is set; honours Do Not Track / Global Privacy Control.
 */
import { analyticsUrl, cleanProps, deviceClass, type DiscoveryPath, type FunnelEvent } from "@/lib/analytics/events";

const DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
const PATH_KEY = "mm.discovery";

function enabled(): boolean {
  if (!DOMAIN || typeof window === "undefined") return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack !== "1" && nav.globalPrivacyControl !== true;
}

export function discoveryPath(): DiscoveryPath {
  try {
    return sessionStorage.getItem(PATH_KEY) === "3d" ? "3d" : "catalog";
  } catch {
    return "catalog";
  }
}

export function markEntered3d(): void {
  try {
    sessionStorage.setItem(PATH_KEY, "3d");
  } catch { /* private mode */ }
}

function send(name: string, props: Record<string, string>, revenue?: { amount: number; currency: string }) {
  if (!enabled()) return;
  const body = JSON.stringify({
    name,
    domain: DOMAIN,
    url: analyticsUrl(location.href),
    referrer: document.referrer ? analyticsUrl(document.referrer) : null,
    props,
    ...(revenue ? { revenue: { amount: revenue.amount, currency: revenue.currency } } : {}),
  });
  try {
    if (navigator.sendBeacon?.("/stats/api/event", new Blob([body], { type: "text/plain" }))) return;
  } catch { /* fall through */ }
  void fetch("/stats/api/event", { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => {});
}

export function trackPageview(): void {
  send("pageview", { device: deviceClass(innerWidth, navigator.maxTouchPoints > 0) });
}

/** A funnel step. `revenue` (major units, e.g. 24.9) only for "purchase". */
export function track(event: FunnelEvent, props: Record<string, unknown> = {}, revenue?: { amount: number; currency: string }): void {
  send(event, { ...cleanProps(props), path: discoveryPath(), device: deviceClass(innerWidth, navigator.maxTouchPoints > 0) }, revenue);
}

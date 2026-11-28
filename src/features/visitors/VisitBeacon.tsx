"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const ENDPOINT = "/api/visit";
const PING_MS = 120_000; // "online now" = seen in the last 5 min: two pings cover it at half the DB writes of 1/min

function send(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
  } catch {
    /* fall through */
  }
  void fetch(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" }, credentials: "same-origin" }).catch(() => {});
}

/**
 * First-party visitor log (no cookies, no third party): one beacon per page view and a ping every minute
 * while the tab is visible. Staff pages (/admin, /dev) are never sent. See app/api/visit/route.ts.
 */
export function VisitBeacon() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (!pathname || /^\/(admin|dev)(\/|$)/.test(pathname)) return;
    const ref = first.current ? document.referrer : "";
    first.current = false;
    send({
      t: "view",
      path: pathname,
      ref,
      lang: navigator.language,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen: `${Math.round(screen.width)}x${Math.round(screen.height)}`,
      touch: navigator.maxTouchPoints ?? 0,
    });
  }, [pathname]);

  useEffect(() => {
    if (pathname && /^\/(admin|dev)(\/|$)/.test(pathname)) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") send({ t: "ping" });
    }, PING_MS);
    return () => window.clearInterval(id);
  }, [pathname]);

  return null;
}

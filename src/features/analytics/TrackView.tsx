"use client";
import { useEffect } from "react";
import type { FunnelEvent } from "@/lib/analytics/events";
import { track } from "./track";

/** Fires one funnel event when a (server-rendered) page mounts. */
export function TrackView({ event, props }: { event: FunnelEvent; props?: Record<string, string | undefined> }) {
  const key = JSON.stringify(props ?? {});
  useEffect(() => {
    track(event, JSON.parse(key) as Record<string, string>);
  }, [event, key]);
  return null;
}

/** "purchase" once per order per browser session (the order page refreshes itself while payment confirms). */
export function TrackPurchase({ orderRef, amount, currency }: { orderRef: string; amount: number; currency: string }) {
  useEffect(() => {
    const k = `mm.purchase.${orderRef}`;
    try {
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
    } catch { /* private mode: may double count on refresh */ }
    track("purchase", {}, { amount, currency });
  }, [orderRef, amount, currency]);
  return null;
}

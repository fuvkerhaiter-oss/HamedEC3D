"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { trackPageview } from "./track";

/** One pageview per client-side route change (query strings are never sent). Skips staff areas. */
export function Pageviews() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || /^\/(admin|seller|dev)(\/|$)/.test(pathname)) return;
    trackPageview();
  }, [pathname]);
  return null;
}

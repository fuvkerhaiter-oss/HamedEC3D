"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Re-renders the (server) page every `seconds` while the tab is visible. Can be paused. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [on, seconds, router]);
  return (
    <button type="button" onClick={() => setOn((v) => !v)} className="btn-ghost !py-1.5 text-xs" aria-pressed={on}>
      <span aria-hidden className={`mr-1.5 inline-block h-2 w-2 rounded-full ${on ? "animate-pulse bg-emerald-500" : "bg-ink-soft/40"}`} />
      {on ? `Live · updates every ${seconds} s` : "Paused · click to go live"}
    </button>
  );
}

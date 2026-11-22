"use client";
/** Touch only: up/down buttons to scroll the 3D supporters wall while the shopper stands in front of it. Hold to keep scrolling. */
import { useEffect, useRef } from "react";
import { nudgeSupporters, useSupportersScroll } from "../wing/supporters-scroll";

export function SupportersScrollButtons() {
  const near = useSupportersScroll((s) => s.near && s.scrollable);
  if (!near) return null;
  return (
    <div
      className="fixed z-20 flex flex-col items-center gap-2 rounded-full bg-ink/70 p-1.5 text-cream shadow-lg backdrop-blur"
      style={{ right: "calc(env(safe-area-inset-right, 0px) + 0.75rem)", top: "calc(env(safe-area-inset-top, 0px) + 5rem)" }}
      role="group"
      aria-label="Scroll the supporters wall"
    >
      <HoldButton rows={-1} label="Scroll supporters up" path="M6 15l6-6 6 6" />
      <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-amber">Names</span>
      <HoldButton rows={1} label="Scroll supporters down" path="M6 9l6 6 6-6" />
    </div>
  );
}

function HoldButton({ rows, label, path }: { rows: number; label: string; path: string }) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      aria-label={label}
      className="grid h-11 w-11 place-items-center rounded-full bg-cream/10 active:bg-amber active:text-ink"
      onPointerDown={(e) => {
        e.stopPropagation();
        nudgeSupporters(rows * 2);
        stop();
        timer.current = setInterval(() => nudgeSupporters(rows), 160);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={path} />
      </svg>
    </button>
  );
}

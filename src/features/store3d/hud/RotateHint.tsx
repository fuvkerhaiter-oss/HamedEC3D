"use client";

import { useEffect, useState } from "react";

/** Phones held upright (tablets and desktops never match). */
const PORTRAIT_PHONE = "(orientation: portrait) and (pointer: coarse) and (max-width: 600px)";
const DISMISS_KEY = "mm.rotateHintDismissed";

/**
 * "Rotate your phone" prompt for phones in portrait. Shown from the moment the store opens (over the loading
 * screen), disappears by itself once the phone is turned, and can be skipped for the rest of the visit.
 */
export function RotateHint() {
  const [portrait, setPortrait] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return typeof window !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    const mq = window.matchMedia(PORTRAIT_PHONE);
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!portrait || dismissed) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
    setDismissed(true);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mm-rotate-title"
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-ink/95 p-8 text-center text-cream backdrop-blur"
    >
      <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden className="text-amber">
        <g className="origin-center animate-[mm-rotate_2.4s_ease-in-out_infinite]" style={{ transformBox: "fill-box" }}>
          <rect x="38" y="16" width="44" height="88" rx="8" fill="none" stroke="currentColor" strokeWidth="5" />
          <circle cx="60" cy="94" r="3.5" fill="currentColor" />
        </g>
        <path d="M100 40a44 44 0 0 1 4 30" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity=".6" />
        <path d="M98 66l6 6 5-7" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity=".6" />
      </svg>
      <h2 id="mm-rotate-title" className="mt-6 font-display text-3xl">Rotate your phone</h2>
      <p className="mt-3 max-w-xs text-sm text-cream/75">
        Turn your phone sideways for the best view of the store, with more room to walk, look around and see other shoppers.
      </p>
      <button type="button" onClick={dismiss} className="mt-8 py-2 text-sm text-cream/70 underline">
        Continue in portrait
      </button>
      <style>{`@keyframes mm-rotate{0%,20%{transform:rotate(0)}50%,80%{transform:rotate(-90deg)}100%{transform:rotate(0)}}`}</style>
    </div>
  );
}

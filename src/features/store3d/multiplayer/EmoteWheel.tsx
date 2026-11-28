"use client";

import { useState } from "react";
import { EMOTES, emoteDef, type EmoteId } from "./emotes";
import { triggerEmote, useNet } from "./net";
import { useStoreUi } from "../ui-store";

/** Cute avatar-style SVG icons matching the store's capsule shoppers. */
export function EmoteAvatarIcon({ id, size = 28 }: { id: EmoteId | "menu"; size?: number }) {
  const skin = "#f1c9a5";
  const eye = "#111513";
  switch (id) {
    case "dance":
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden>
          <g transform="rotate(-10 18 20)">
            <rect x="13" y="15" width="10" height="14" rx="5" fill="#ff5c93" />
            <circle cx="18" cy="10" r="5" fill={skin} />
            <circle cx="16.5" cy="9.5" r="0.9" fill={eye} />
            <circle cx="19.5" cy="9.5" r="0.9" fill={eye} />
            <path d="M13 18 L6 10" stroke="#ff5c93" strokeWidth="3.2" strokeLinecap="round" />
            <path d="M23 18 L30 22" stroke="#ff5c93" strokeWidth="3.2" strokeLinecap="round" />
          </g>
          <path d="M28 6 v6 M28 6 l3 -1 v4" stroke="#f7c416" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "wave":
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden>
          <rect x="13" y="16" width="10" height="14" rx="5" fill="#38bdf8" />
          <circle cx="18" cy="10.5" r="5" fill={skin} />
          <circle cx="16.3" cy="10" r="0.9" fill={eye} />
          <circle cx="19.7" cy="10" r="0.9" fill={eye} />
          <path d="M16.5 12.2 Q18 13.6 19.5 12.2" stroke={eye} strokeWidth="1.1" strokeLinecap="round" />
          <path d="M13 19 L9 24" stroke="#38bdf8" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M23 18 L29 8" stroke="#38bdf8" strokeWidth="3.2" strokeLinecap="round" />
          <circle cx="29.5" cy="7.5" r="2" fill={skin} />
          <path d="M31.5 6 C33 7.5 33 10 31.5 11.5" stroke="#f7c416" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "spin":
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden>
          <rect x="13" y="15" width="10" height="13" rx="5" fill="#a855f7" />
          <circle cx="18" cy="10" r="5" fill={skin} />
          <circle cx="16.5" cy="9.5" r="0.9" fill={eye} />
          <circle cx="19.5" cy="9.5" r="0.9" fill={eye} />
          <path d="M13 18 L5 17" stroke="#a855f7" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M23 18 L31 17" stroke="#a855f7" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M7 26 C11 31 25 31 29 26" stroke="#f7c416" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M27 24.5 L29.5 26 L28 28.5" stroke="#f7c416" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "cheer":
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden>
          <rect x="13" y="14" width="10" height="13" rx="5" fill="#2dd4bf" />
          <circle cx="18" cy="9.5" r="4.8" fill={skin} />
          <circle cx="16.4" cy="9" r="0.9" fill={eye} />
          <circle cx="19.6" cy="9" r="0.9" fill={eye} />
          <path d="M13 16 L7 6" stroke="#2dd4bf" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M23 16 L29 6" stroke="#2dd4bf" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M18 2 L18 4 M11 30 L13 28 M25 30 L23 28" stroke="#f7c416" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "dab":
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden>
          <rect x="13" y="16" width="10" height="14" rx="5" fill="#f7c416" />
          <circle cx="17" cy="12" r="4.8" fill={skin} />
          <path d="M13 18 L21 12" stroke="#f7c416" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M23 18 L32 8" stroke="#f7c416" strokeWidth="3.4" strokeLinecap="round" />
          <rect x="13.5" y="10.5" width="7" height="2.6" rx="1" fill="#111513" />
        </svg>
      );
    case "laugh":
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden>
          <g transform="rotate(10 18 20)">
            <rect x="13" y="16" width="10" height="14" rx="5" fill="#ff5a36" />
            <circle cx="18" cy="10.5" r="5" fill={skin} />
            <path d="M15.2 9.5 L16.8 10.2 L15.2 11" stroke={eye} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M20.8 9.5 L19.2 10.2 L20.8 11" stroke={eye} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 12.2 Q18 14.5 20 12.2 Z" fill={eye} />
            <path d="M13 19 L17 22" stroke="#ff5a36" strokeWidth="3" strokeLinecap="round" />
            <path d="M23 19 L19 22" stroke="#ff5a36" strokeWidth="3" strokeLinecap="round" />
          </g>
          <circle cx="26" cy="10" r="1.4" fill="#38bdf8" />
          <circle cx="10" cy="11" r="1.4" fill="#38bdf8" />
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden>
          <rect x="13" y="16" width="10" height="13" rx="5" fill="#f7c416" />
          <circle cx="18" cy="10.5" r="5" fill={skin} />
          <circle cx="16.3" cy="10" r="0.9" fill={eye} />
          <circle cx="19.7" cy="10" r="0.9" fill={eye} />
          <path d="M16.2 12.2 Q18 13.8 19.8 12.2" stroke={eye} strokeWidth="1.2" strokeLinecap="round" />
          <path d="M13 18 L7 11" stroke="#f7c416" strokeWidth="3" strokeLinecap="round" />
          <path d="M23 18 L29 11" stroke="#f7c416" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
  }
}

/** Single compact button that expands into a radial wheel of funny avatar emotes. */
export function EmoteWheel() {
  const [open, setOpen] = useState(false);
  const myEmote = useNet((s) => s.myEmote);
  const stage = useStoreUi((s) => s.stage);

  if (stage !== "play") return null;

  const R = 74; // radial wheel radius in px

  return (
    <div
      className="fixed left-1/2 z-30 -translate-x-1/2"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
    >
      {/* Radial circle wheel when open */}
      {open && (
        <div
          className="absolute bottom-14 left-1/2 h-[196px] w-[196px] -translate-x-1/2 rounded-full bg-ink/80 shadow-2xl ring-2 ring-amber/50 backdrop-blur-md"
          role="menu"
          aria-label="Choose an emote"
        >
          {/* center label / close button */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-cream/10 text-[10px] font-bold uppercase tracking-wider text-cream/80 ring-1 ring-cream/25 hover:bg-cream/20"
            title="Close emotes"
          >
            Close
          </button>

          {EMOTES.map((em, i) => {
            const angle = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
            const x = 98 + Math.cos(angle) * R;
            const y = 98 + Math.sin(angle) * R;
            const active = myEmote === em.id;
            return (
              <button
                key={em.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  triggerEmote(em.id);
                  if (useNet.getState().myEmote === em.id) {
                    useStoreUi.getState().showToast(`${em.label}!`);
                  }
                  setOpen(false);
                }}
                title={`${em.label} (press ${em.key})`}
                style={{ left: `${x}px`, top: `${y}px` }}
                className={`group absolute flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full transition-transform hover:scale-110 ${
                  active ? "bg-amber text-ink ring-2 ring-white shadow-lg" : "bg-ink/90 text-cream ring-1 ring-cream/25 hover:ring-amber"
                }`}
              >
                <EmoteAvatarIcon id={em.id} size={28} />
                <span className={`-mt-1 text-[9px] font-bold leading-none ${active ? "text-ink" : "text-cream/70"}`}>{em.key}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Single trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Emotes"
        title={myEmote ? `${emoteDef(myEmote).label} (click to open emotes)` : "Emotes (keys 1–6)"}
        className={`flex h-11 items-center gap-1.5 rounded-full px-3 shadow-lg ring-1 backdrop-blur transition ${
          myEmote || open ? "bg-amber text-ink ring-white/70" : "bg-ink/75 text-cream ring-cream/20 hover:bg-ink"
        }`}
      >
        <EmoteAvatarIcon id={myEmote ?? "menu"} size={24} />
        <span className="text-xs font-bold">{myEmote ? emoteDef(myEmote).label : "Emotes"}</span>
      </button>
    </div>
  );
}

"use client";

/**
 * Typography picker for the 3D shop sign. Each option shows the font name rendered *in that font* inside a mini
 * sign-shaped card, giving the owner an instant feel for every typeface before they commit.
 *
 * Uses the same CSS variables that next/font registers on <html> (src/app/sign-fonts.ts). The card background mimics
 * the sign's coloured face so the preview is realistic.
 */

import { useState } from "react";
import { SIGN_FONTS, DEFAULT_SIGN_FONT, signText, type SignFont } from "@/lib/rentals/sign-fonts";

/** Groups that appear as labelled sections in the picker. */
const GROUPS: { label: string; ids: string[] }[] = [
  {
    label: "Strong & Commanding",
    ids: ["bricolage", "bebas-neue", "anton", "syne", "alfa-slab", "bungee", "russo-one", "black-ops-one", "rubik-mono"],
  },
  {
    label: "Sexy, Luxury & Editorial",
    ids: ["bodoni-moda", "cinzel", "yeseva-one", "abril-fatface", "playfair"],
  },
  {
    label: "Creative, Neon & Cyber",
    ids: ["monoton", "orbitron", "audiowide", "press-start"],
  },
  {
    label: "Retro & Groovy",
    ids: ["shrikhand", "righteous"],
  },
  {
    label: "Fun & Cartoon",
    ids: ["luckiest-guy", "bangers", "lilita-one", "titan-one", "fredoka"],
  },
  {
    label: "Script & Signature",
    ids: ["pacifico", "lobster", "sacramento", "permanent-marker"],
  },
];

function FontCard({
  font,
  accent,
  selected,
  onSelect,
}: {
  font: SignFont;
  accent: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const displayText = signText(font.label, font);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={`${font.label} — ${font.mood}`}
      className={`group relative flex flex-col items-center gap-1.5 rounded-2xl p-1.5 ring-1 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 ${
        selected
          ? "scale-[1.03] ring-2 ring-ink shadow-md"
          : "ring-line hover:ring-ink/40 hover:shadow-sm"
      }`}
    >
      {/* mini sign face */}
      <div
        className="relative flex h-14 w-full items-center justify-center overflow-hidden rounded-xl px-2"
        style={{ background: accent }}
      >
        {/* subtle cream outline glow */}
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/30" />
        <span
          className="max-w-full truncate text-center leading-none"
          style={{
            fontFamily: `var(${font.cssVar}), "Arial Black", sans-serif`,
            fontWeight: font.weight,
            fontSize: "clamp(11px, 2.8vw, 18px)",
            color: "#fff3d1",
            textShadow: "0 1px 3px rgba(0,0,0,0.55)",
            letterSpacing: font.upper ? "0.04em" : undefined,
          }}
        >
          {displayText}
        </span>
        {selected && (
          <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink text-[9px] text-white">
            ✓
          </span>
        )}
      </div>
      {/* label below the sign */}
      <p className="max-w-full truncate px-1 text-center text-[10px] font-semibold leading-tight text-ink-soft">
        {font.mood}
      </p>
    </button>
  );
}

export function SignFontPicker({
  value,
  accent,
  onChange,
}: {
  value: string;
  accent: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      {GROUPS.map((g) => {
        const fonts = g.ids
          .map((id) => SIGN_FONTS.find((f) => f.id === id))
          .filter((f): f is SignFont => !!f);
        if (!fonts.length) return null;
        return (
          <div key={g.label}>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-ink-soft">
              {g.label}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
              {fonts.map((font) => (
                <FontCard
                  key={font.id}
                  font={font}
                  accent={accent}
                  selected={value === font.id}
                  onSelect={() => onChange(font.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Hidden input that carries the selected font id to the form action. */
export function SignFontInput({ value }: { value: string }) {
  return <input type="hidden" name="signFont" value={value} />;
}

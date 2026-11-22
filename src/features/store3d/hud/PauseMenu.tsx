"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { unlockVoiceAudio } from "../multiplayer/net";
import { isMusicMuted, startStoreMusic, subscribeMusicMuted, toggleMusicMuted } from "../music";
import { getSensitivity, resetTouchInput, SENSITIVITY_LEVELS, setSensitivity, type SensitivityId } from "../input/touch-input";
import { useStoreUi } from "../ui-store";

/** True after the first "Enter": the menu then reads "Paused / Resume" instead of "Welcome in / Enter". */
let enteredOnce = false;

/** A keyboard key, drawn like a real keycap. */
function Key({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <kbd
      className={`inline-flex h-8 items-center justify-center rounded-lg border border-b-[3px] border-[#d6d5cc] bg-white px-2 font-mono text-[13px] font-semibold leading-none text-[#0d0f0e] shadow-[0_1px_0_rgb(0_0_0/0.04)] ${wide ? "min-w-14" : "min-w-8"}`}
    >
      {children}
    </kbd>
  );
}

function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d={d} />
    </svg>
  );
}

const ICON = {
  mouse: "M12 3a6 6 0 0 0-6 6v6a6 6 0 0 0 12 0V9a6 6 0 0 0-6-6Zm0 0v5",
  stick: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  drag: "M5 12h14M12 5v14M8 8l-3 4 3 4M16 8l3 4-3 4",
  hand: "M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5v-6a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V13a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5.2-3l-2.1-3.7a1.5 1.5 0 0 1 2.6-1.5L8 13",
  cart: "M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6.2M9 20.5h.01M17 20.5h.01",
  music: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
};

function Row({ keys, label, hint }: { keys: ReactNode; label: string; hint?: string }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="flex w-[9.5rem] shrink-0 items-center gap-1">{keys}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[#0d0f0e]">{label}</span>
        {hint && <span className="block text-xs text-[#5b615d]">{hint}</span>}
      </span>
    </li>
  );
}

function TouchRow({ icon, title, label }: { icon: string; title: string; label: string }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f2f1ea] text-[#0d0f0e]"><Icon d={icon} /></span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[#0d0f0e]">{title}</span>
        <span className="block text-xs text-[#5b615d]">{label}</span>
      </span>
    </li>
  );
}

function MusicSwitch() {
  const muted = useSyncExternalStore(subscribeMusicMuted, isMusicMuted, () => false);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!muted}
      onClick={toggleMusicMuted}
      className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-1.5 text-left"
    >
      <span className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f2f1ea] text-[#0d0f0e]"><Icon d={ICON.music} /></span>
        <span className="text-sm font-medium text-[#0d0f0e]">Music</span>
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${muted ? "bg-[#d6d5cc]" : "bg-[#12392b]"}`} aria-hidden>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${muted ? "left-0.5" : "left-[1.375rem]"}`} />
      </span>
    </button>
  );
}

/**
 * Start / pause screen of the 3D store. Desktop: keycap legend + Click to enter (pointer lock). Touch: thumb
 * controls, look sensitivity, Tap to enter (fullscreen + landscape where allowed). Landscape phones get two
 * columns so the main button is always on screen. Colors are explicit (it sits over the 3D scene, not a page).
 */
export function PauseMenu({ touchMode, onEnter }: { touchMode: boolean; onEnter: () => void }) {
  const [sens, setSens] = useState<SensitivityId>(getSensitivity);
  const lockError = useStoreUi((s) => s.lockError);
  const resumed = enteredOnce;

  const enter = () => {
    enteredOnce = true;
    resetTouchInput();
    unlockVoiceAudio();
    startStoreMusic(); // inside the click: browsers only allow audio after a user gesture
    if (touchMode) {
      // Immersive on Android/iPad; unsupported (iPhone) or refused → stays in the browser UI.
      const root = document.documentElement;
      if (!document.fullscreenElement && root.requestFullscreen) {
        root
          .requestFullscreen({ navigationUI: "hide" })
          // Android phones: hold landscape while in the store (needs fullscreen; iPhone ignores it → RotateHint).
          .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape"))
          .catch(() => {});
      }
    }
    onEnter();
  };

  const title = resumed ? "Paused" : "Welcome in";
  const action = resumed ? "Resume shopping" : "Enter the store";

  return (
    <div className="fixed inset-0 z-20 flex overflow-y-auto overscroll-contain bg-[#0d0f0e]/60 p-3 pt-[4.25rem] backdrop-blur-md sm:p-6 sm:pt-6 short:pt-[4.25rem]" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <div className="m-auto w-full max-w-2xl overflow-hidden rounded-[1.75rem] bg-[#fcfcf9] text-[#0d0f0e] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.6)] ring-1 ring-black/5 short:max-w-4xl">
        <div className="short:grid short:grid-cols-[1.15fr_1fr]">
          {/* Left / top: title + controls */}
          <div className="p-5 sm:p-7 short:p-5">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-[#f7c416] font-display text-sm text-[#0d0f0e]">W</span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5b615d]">WEGO SHIIIP · 3D store</span>
            </div>
            <h1 id="pause-title" className="mt-4 font-display text-3xl leading-tight text-[#0d0f0e] sm:text-4xl short:mt-3 short:text-2xl">{title}</h1>
            <p className="mt-1.5 text-sm text-[#5b615d]">
              {touchMode ? "Walk the aisles, look at a product and tap ✋ to see it." : "Walk the aisles, aim at a product and press E to see it."}
            </p>

            <h2 className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5b615d] short:mt-3">Controls</h2>
            {touchMode ? (
              <ul className="mt-1 grid divide-y divide-[#ecebe3] sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0 short:grid-cols-2 short:gap-x-4 short:divide-y-0">
                <TouchRow icon={ICON.stick} title="Left thumb" label="Walk · push to the edge to run" />
                <TouchRow icon={ICON.drag} title="Right thumb" label="Drag to look around" />
                <TouchRow icon={ICON.hand} title="✋ button" label="See the product in front of you" />
                <TouchRow icon={ICON.cart} title="Cart button" label="Review your cart & pay" />
              </ul>
            ) : (
              <ul className="mt-1 grid divide-y divide-[#ecebe3] sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0">
                <Row keys={<span className="inline-flex items-center gap-1.5 text-[#0d0f0e]"><Icon d={ICON.mouse} /><span className="text-xs font-semibold">Mouse</span></span>} label="Look around" />
                <Row keys={<><Key>W</Key><Key>A</Key><Key>S</Key><Key>D</Key></>} label="Walk" />
                <Row keys={<Key wide>Shift</Key>} label="Run" hint="Hold while walking" />
                <Row keys={<Key>E</Key>} label="See a product" hint="Details & add to trolley" />
                <Row keys={<Key>C</Key>} label="Open cart" />
                <Row keys={<Key>M</Key>} label="Music on / off" />
                <Row keys={<Key>V</Key>} label="Talk (mic on / off)" hint="With other shoppers in your room" />
                <Row keys={<Key wide>Esc</Key>} label="Pause" hint="Shows this menu" />
              </ul>
            )}
          </div>

          {/* Right / bottom: main action + settings + links */}
          <div className="border-t border-[#ecebe3] bg-[#f6f5ef] p-5 sm:p-7 short:flex short:flex-col short:justify-center short:border-l short:border-t-0 short:p-5">
            <button
              autoFocus
              type="button"
              onClick={enter}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0d0f0e] px-6 py-4 text-base font-semibold text-white shadow-lg transition hover:bg-[#12392b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f7c416]/60 active:scale-[0.99]"
            >
              {action}
              <span aria-hidden>→</span>
            </button>
            <p className="mt-2 text-center text-xs text-[#5b615d]">
              {touchMode ? "Tap the button to start" : "Click the button to start · Esc pauses again"}
            </p>
            {lockError && !touchMode && (
              <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-800">{lockError}</p>
            )}

            <h2 className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5b615d] short:mt-4">Settings</h2>
            <div className="mt-2 space-y-2 rounded-2xl bg-white p-2 ring-1 ring-[#ecebe3]">
              <MusicSwitch />
              {touchMode && (
                <fieldset className="px-1 pb-1">
                  <legend className="mb-2 text-sm font-medium text-[#0d0f0e]">Look sensitivity</legend>
                  <div className="grid grid-cols-3 gap-1 rounded-full bg-[#f2f1ea] p-1">
                    {SENSITIVITY_LEVELS.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        aria-pressed={sens === l.id}
                        onClick={() => {
                          setSensitivity(l.id);
                          setSens(l.id);
                        }}
                        className={`rounded-full px-3 py-2 text-sm font-medium transition ${sens === l.id ? "bg-[#0d0f0e] text-white shadow" : "text-[#454b47]"}`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href="/catalog" className="rounded-full border border-[#d6d5cc] bg-white px-4 py-2.5 text-center text-sm font-medium text-[#0d0f0e] transition hover:border-[#0d0f0e]">
                List view
              </Link>
              <Link
                href="/"
                className="rounded-full border border-[#d6d5cc] bg-white px-4 py-2.5 text-center text-sm font-medium text-[#0d0f0e] transition hover:border-[#0d0f0e]"
                onClick={(e) => {
                  const leave = useStoreUi.getState().onLeave; // homepage embed: glide back to the hero
                  if (leave) { e.preventDefault(); leave(); }
                }}
              >
                Leave store
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

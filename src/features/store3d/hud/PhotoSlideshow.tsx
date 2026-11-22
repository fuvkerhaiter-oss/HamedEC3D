"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent, type RefObject } from "react";
import { canOptimize } from "@/lib/catalog/image";
import type { ProductImage } from "@/lib/catalog/types";
import { slideLayers, stepIndex } from "./slideshow";

/** Time each photo stays before crossfading to the next. */
export const SLIDE_MS = 2800;
const SWIPE_PX = 40;

const RM = "(prefers-reduced-motion: reduce)";
const subscribeRM = (cb: () => void) => {
  const m = window.matchMedia(RM);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const getRM = () => window.matchMedia(RM).matches;
const getRMServer = () => true; // no auto-advance before hydration

/**
 * Product photo slideshow for the 3D store popups: crossfades through `images` (main photo first) every
 * ~2.8 s, looping. Only the visible photo, the one fading out and the NEXT photo are mounted, all through
 * next/image with the caller's `sizes`, so each photo is fetched once as a resized cached copy.
 * Auto-advance pauses on hover/focus, waits for the next photo to load, stops when `active` is false and
 * never runs for visitors who prefer reduced motion (manual controls still work).
 * Callers render their own single-photo / no-photo view; this is for 2+ photos.
 */
export function PhotoSlideshow({
  images,
  sizes,
  decorative = false,
  controls = false,
  active = true,
  keyTarget,
}: {
  images: ProductImage[];
  sizes: string;
  /** Alt text off (the surrounding card already names the product). */
  decorative?: boolean;
  /** Prev/next buttons, clickable dots, swipe and arrow keys (full product dialog). */
  controls?: boolean;
  active?: boolean;
  /** Arrow keys switch photos only while focus is inside this element (never fights WASD/arrow walking). */
  keyTarget?: RefObject<HTMLElement | null>;
}) {
  const n = images.length;
  const [slide, setSlide] = useState({ from: 0, current: 0 });
  const [paused, setPaused] = useState(false);
  const reduced = useSyncExternalStore(subscribeRM, getRM, getRMServer);
  const root = useRef<HTMLDivElement>(null);
  const loaded = useRef(new Set<string>());
  const pending = useRef(false); // timer fired while the next photo was still loading
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);

  const current = Math.min(slide.current, n - 1);
  const playing = n > 1 && active && !paused && !reduced;
  const playingRef = useRef(playing);
  const nextUrl = images[stepIndex(current, n, 1)]?.url;

  const go = useCallback((step: number) => {
    pending.current = false;
    setSlide((s) => ({ from: s.current, current: stepIndex(s.current, n, step) }));
  }, [n]);
  const show = (i: number) => {
    pending.current = false;
    setSlide((s) => (s.current === i ? s : { from: s.current, current: i }));
  };

  useEffect(() => {
    playingRef.current = playing;
    if (!playing) return;
    const t = setTimeout(() => {
      if (nextUrl && loaded.current.has(nextUrl)) go(1);
      else pending.current = true;
    }, SLIDE_MS);
    return () => {
      clearTimeout(t);
      pending.current = false;
    };
  }, [playing, current, nextUrl, go]);

  const onLoaded = (url: string) => {
    loaded.current.add(url);
    if (pending.current && playingRef.current && url === nextUrl) go(1);
  };

  useEffect(() => {
    const el = keyTarget?.current;
    if (!controls || !el || n < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      e.preventDefault();
      go(e.key === "ArrowRight" ? 1 : -1);
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [controls, keyTarget, n, go]);

  const onPointerDown = (e: PointerEvent) => {
    if (controls && e.pointerType !== "mouse") swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1);
  };

  return (
    <div
      ref={root}
      className="absolute inset-0"
      style={controls ? { touchAction: "pan-y" } : undefined}
      {...(controls ? { role: "group", "aria-roledescription": "carousel", "aria-label": "Product photos" } : {})}
      onPointerEnter={(e) => e.pointerType === "mouse" && setPaused(true)}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse" && !root.current?.contains(document.activeElement)) setPaused(false);
        swipe.current = null;
      }}
      onFocus={() => setPaused(true)}
      onBlur={(e) => !root.current?.contains(e.relatedTarget as Node | null) && !root.current?.matches(":hover") && setPaused(false)}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (swipe.current = null)}
    >
      {slideLayers(slide.from, current, n).map((i) => {
        const g = images[i]!;
        const on = i === current;
        return (
          <div key={i} className="absolute inset-0 transition-opacity duration-700 ease-in-out motion-reduce:transition-none" style={{ opacity: on ? 1 : 0 }} aria-hidden={!on || undefined}>
            <Image src={g.url} unoptimized={!canOptimize(g.url)} alt={decorative ? "" : g.alt} fill sizes={sizes} className="object-cover" draggable={false} onLoad={() => onLoaded(g.url)} />
          </div>
        );
      })}

      {controls && (
        <>
          <p className="sr-only" aria-live={playing ? "off" : "polite"}>Photo {current + 1} of {n}</p>
          <button type="button" onClick={() => go(-1)} aria-label="Previous photo"
            className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-cream/85 text-lg leading-none text-ink shadow hover:bg-cream focus-visible:outline-2 focus-visible:outline-ink">‹</button>
          <button type="button" onClick={() => go(1)} aria-label="Next photo"
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-cream/85 text-lg leading-none text-ink shadow hover:bg-cream focus-visible:outline-2 focus-visible:outline-ink">›</button>
        </>
      )}
      <div className={`absolute inset-x-0 bottom-2 flex justify-center ${controls ? "" : "gap-1"}`} aria-hidden={!controls || undefined}>
        {images.map((g, i) =>
          controls ? (
            <button key={i} type="button" onClick={() => show(i)} aria-label={`Show photo ${i + 1} of ${n}`} aria-current={i === current || undefined} className="group p-1.5">
              <span className={`block h-2 rounded-full shadow transition-all ${i === current ? "w-5 bg-cream" : "w-2 bg-cream/60 group-hover:bg-cream/90"}`} />
            </button>
          ) : (
            <span key={i} className={`block h-1.5 rounded-full shadow transition-all ${i === current ? "w-4 bg-white" : "w-1.5 bg-white/60"}`} />
          ),
        )}
      </div>
    </div>
  );
}

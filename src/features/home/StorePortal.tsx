"use client";

import dynamic from "next/dynamic";
import Image, { type StaticImageData } from "next/image";
import { useRouter } from "next/navigation";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { startStoreMusic } from "@/features/store3d/music";
import { startMatchmakingEarly } from "@/features/store3d/portal";
import { canRunStore } from "@/features/store3d/StoreClient";
import type { StoreCatalog } from "@/features/store3d/StoreScene";
import { useStoreUi } from "@/features/store3d/ui-store";
import { playWhoosh } from "@/lib/fx/whoosh";
import enterSign from "@/assets/hero/enter-store-sign.webp";

const StoreExperience = dynamic(() => import("@/features/store3d/StoreExperience"), { ssr: false });
const ENTER_EVENT = "mm:enter-store";

/** A link-styled button that enters the store through the hero (falls back to /store without JS). */
export function EnterStoreButton({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <a
      href="/store"
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new tab etc.
        e.preventDefault();
        window.dispatchEvent(new Event(ENTER_EVENT));
      }}
    >
      {children}
    </a>
  );
}

/** If the live store fails in the hero, keep the still picture (entering then opens /store). */
class LiveBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onError();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Homepage hero = the real 3D store. Shows the rendered still at once, quietly loads the live scene in the
 * background and crossfades to it (slow cinematic camera). Click → woosh, the frame grows to full screen while
 * the 3D camera flies down the aisle into the shopper's eyes, and play starts in place: no page change, no
 * loading screen. The visitor's shared room is picked during the flight.
 */
export function StorePortal({ image, catalog }: { image: StaticImageData; catalog: StoreCatalog }) {
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  const restore = useRef<(() => void) | null>(null);
  const [load, setLoad] = useState(false);
  const [failed, setFailed] = useState(false);
  const [clickedEarly, setClickedEarly] = useState(false); // clicked before the live scene was ready
  const flewEarly = useRef(false);
  const ready = useStoreUi((s) => s.ready);
  const stage = useStoreUi((s) => s.stage);
  const preview = !load || stage === "preview";
  const pending = clickedEarly && !ready;

  // Background preload once the page is idle (skipped on data-saver / slow connections: loads on click instead).
  useEffect(() => {
    if (!canRunStore()) return;
    const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (c?.saveData || /(^|-)2g|3g/.test(c?.effectiveType ?? "")) return;
    const start = () => setLoad(true);
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(start, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(start, 1200);
    return () => clearTimeout(id);
  }, []);

  /** Lift the hero frame out of the page's stacking/masking so the store can cover the whole screen. */
  const detach = useCallback(() => {
    const slot = wrap.current?.parentElement;
    const section = slot?.closest("section");
    if (!slot || !section) return;
    const prev = { mask: slot.style.maskImage, wmask: slot.style.webkitMaskImage, z: slot.style.zIndex, iso: section.style.isolation, overflow: document.documentElement.style.overflow };
    slot.style.maskImage = slot.style.webkitMaskImage = "none";
    slot.style.zIndex = "auto";
    section.style.isolation = "auto";
    document.documentElement.style.overflow = "hidden";
    restore.current = () => {
      slot.style.maskImage = prev.mask;
      slot.style.webkitMaskImage = prev.wmask;
      slot.style.zIndex = prev.z;
      section.style.isolation = prev.iso;
      document.documentElement.style.overflow = prev.overflow;
    };
  }, []);

  const fly = useCallback(
    (inGesture: boolean) => {
      detach();
      const ui = useStoreUi.getState();
      // Desktop: mouse capture is only allowed inside the click, so request it now; it holds through the flight.
      if (inGesture && !ui.touchMode) ui.requestLock();
      useStoreUi.setState({
        onLeave: () => {
          const s = useStoreUi.getState();
          s.releaseLock();
          s.setLocked(false);
          s.setStage("preview");
          restore.current?.();
          restore.current = null;
        },
      });
      ui.setStage("entering");
    },
    [detach],
  );

  const enter = useCallback(() => {
    if (load && stage !== "preview") return;
    if (failed || !canRunStore()) return router.push("/store");
    playWhoosh();
    startMatchmakingEarly();
    startStoreMusic(); // inside the click: allowed to start audio
    if (load && ready) return fly(true);
    setLoad(true);
    setClickedEarly(true);
  }, [load, stage, failed, ready, fly, router]);

  // Clicked early: fly in as soon as the scene is ready (desktop then needs one click to capture the mouse).
  useEffect(() => {
    if (!clickedEarly || !ready || flewEarly.current) return;
    flewEarly.current = true;
    fly(false);
  }, [clickedEarly, ready, fly]);

  useEffect(() => {
    const onEnter = () => enter();
    window.addEventListener(ENTER_EVENT, onEnter);
    return () => window.removeEventListener(ENTER_EVENT, onEnter);
  }, [enter]);

  useEffect(() => () => restore.current?.(), []);

  return (
    <div ref={wrap} className="relative h-full w-full">
      <span className="vsw-hero-bg absolute inset-0">
        <Image src={image} alt="" fill priority placeholder="blur" sizes="(min-width: 1024px) 62vw, 100vw" className="object-cover object-[50%_45%]" />
      </span>

      {load && !failed && (
        <LiveBoundary onError={() => setFailed(true)}>
          <StoreExperience catalog={catalog} embedded />
        </LiveBoundary>
      )}

      {preview && (
        <button
          type="button"
          onClick={enter}
          aria-label="Enter the 3D store"
          className="vsw-portal group absolute inset-0 z-10 block cursor-pointer text-left outline-none"
        >
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_48%,transparent_35%,rgb(17_21_19/0.5)_100%)]" />
          <span className="absolute left-1/2 top-[60%] flex -translate-x-1/2 sm:top-[48%] -translate-y-1/2 flex-col items-center gap-2 lg:left-[62%]">
            <Image
              src={enterSign}
              alt=""
              priority
              sizes="(min-width: 640px) 380px, 72vw"
              className={`h-auto w-[60vw] max-w-[300px] drop-shadow-[0_10px_30px_rgb(0_0_0/0.45)] transition duration-300 group-hover:scale-105 group-focus-visible:scale-105 sm:max-w-[380px] ${pending ? "animate-pulse" : ""}`}
            />
            {pending && (
              <span className="flex items-center gap-2 rounded-full bg-ink/70 px-4 py-2 font-display text-sm font-semibold text-cream shadow-lg ring-1 ring-cream/20 backdrop-blur sm:text-base">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-cream/25 border-t-cream" aria-hidden />
                Opening the doors…
              </span>
            )}
          </span>
          <span className="absolute bottom-[14%] left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-ink/60 px-3.5 py-1.5 text-xs text-cream/90 ring-1 ring-cream/15 backdrop-blur lg:bottom-8 lg:left-[62%]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            {ready && load ? "Live 3D · " : ""}you join a room with up to 10 shoppers
          </span>
        </button>
      )}
    </div>
  );
}

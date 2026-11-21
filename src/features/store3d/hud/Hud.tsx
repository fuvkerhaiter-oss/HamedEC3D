"use client";

import Link from "next/link";
import { unlockVoiceAudio } from "../multiplayer/net";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CartButton } from "@/components/CartButton";
import { MarketSwitch } from "@/components/MarketSwitch";
import { useCart } from "@/features/cart/cart-store";
import { interactWithTarget, openCartFromStore } from "../actions";
import { isMusicMuted, setMusicDucked, startStoreMusic, stopStoreMusic, subscribeMusicMuted, toggleMusicMuted } from "../music";
import { getSensitivity, resetTouchInput, SENSITIVITY_LEVELS, setSensitivity, type SensitivityId } from "../input/touch-input";
import type { StoreCatalog } from "../StoreScene";
import { addToTrolley } from "../trolley/addToTrolley";
import { useStoreUi } from "../ui-store";
import { ProductPanel } from "./ProductPanel";
import { ProductPeek } from "./ProductPeek";
import { TouchControls } from "./TouchControls";

export function Hud({ catalog }: { catalog: StoreCatalog }) {
  const locked = useStoreUi((s) => s.locked);
  const ready = useStoreUi((s) => s.ready);
  const target = useStoreUi((s) => s.target);
  const openProductId = useStoreUi((s) => s.openProductId);
  const requestLock = useStoreUi((s) => s.requestLock);
  const touchMode = useStoreUi((s) => s.touchMode);
  const cartOpen = useCart((s) => s.open);
  const toast = useStoreUi((s) => s.toast);
  const inspect = useStoreUi((s) => s.inspect);
  const product = openProductId ? catalog.products.find((p) => p.id === openProductId) ?? null : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!useStoreUi.getState().locked) return;
      if (e.code === "KeyE") {
        if (interactWithTarget()) e.preventDefault();
      } else if (e.code === "KeyC") {
        openCartFromStore();
      } else if (e.code === "KeyM") {
        toggleMusicMuted();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Background music: full volume while walking, quieter in menus, fades out when leaving the store.
  useEffect(() => {
    const unsub = useStoreUi.subscribe((s, prev) => {
      if (s.locked !== prev.locked) setMusicDucked(!s.locked);
    });
    return () => {
      unsub();
      stopStoreMusic();
    };
  }, []);

  // Touch: closing the cart drops you straight back into the aisles (desktop needs a click for pointer lock).
  useEffect(
    () =>
      useCart.subscribe((s, prev) => {
        const ui = useStoreUi.getState();
        if (prev.open && !s.open && ui.touchMode && ui.ready && !ui.openProductId && !ui.inspect) ui.requestLock();
      }),
    [],
  );

  const showPause = ready && !locked && !product && !cartOpen && !inspect;
  const showTouchControls = touchMode && ready && locked && !product && !cartOpen && !inspect;

  return (
    <>
      {locked && (
        <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center" aria-hidden>
          <div className={`rounded-full transition-all ${target ? "h-3 w-3 bg-amber ring-4 ring-amber/30" : "h-1.5 w-1.5 bg-white/90 ring-2 ring-black/30"}`} />
        </div>
      )}

      {/* Products: the 3D preview card carries name, price and the action hint. */}
      <ProductPeek catalog={catalog} />

      {locked && target && target.kind !== "product" && (
        <div
          className={`pointer-events-none fixed inset-x-0 z-10 flex justify-center px-4 ${touchMode ? "top-[calc(50%+2.25rem)]" : "bottom-24"}`}
          role="status"
        >
          <div className="flex max-w-full items-center gap-3 rounded-full bg-ink/80 px-5 py-2.5 text-cream backdrop-blur">
            {touchMode ? (
              <span className="shrink-0 whitespace-nowrap rounded-md bg-amber px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-ink">Tap ✋</span>
            ) : (
              <kbd className="rounded-md bg-cream px-2 py-0.5 font-mono text-sm text-ink">E</kbd>
            )}
            <span className="truncate text-sm sm:text-base">Review cart &amp; checkout</span>
          </div>
        </div>
      )}

      {locked && !touchMode && (
        <p className="pointer-events-none fixed bottom-4 left-4 z-10 text-xs text-ink/60">
          WASD move · Shift run · E interact · C cart · M music · V mic · Esc pause
        </p>
      )}

      {showTouchControls && <TouchControls />}

      {toast && (
        <div
          key={toast.id}
          className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 1.5rem)" }}
          role="status"
          aria-live="polite"
        >
          <p className="animate-[fadein_.25s_ease-out] rounded-full bg-ink/85 px-5 py-2.5 text-center text-sm text-cream shadow-lg backdrop-blur">{toast.text}</p>
        </div>
      )}

      {!locked && !inspect && (
        <div className="fixed z-30 flex items-center gap-3" style={{ right: "calc(env(safe-area-inset-right, 0px) + 1rem)", top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}>
          <MusicToggle />
          <MarketSwitch dark />
          <CartButton dark />
        </div>
      )}

      {showPause && <PauseMenu touchMode={touchMode} onEnter={requestLock} />}

      {product && (
        <ProductPanel
          product={product}
          onClose={(resume) => {
            useStoreUi.getState().openProduct(null);
            if (resume) requestLock();
          }}
          onAdd={(variantId, quantity) => {
            const added = addToTrolley(variantId, product.id, quantity);
            const ui = useStoreUi.getState();
            ui.openProduct(null);
            requestLock(); // back to first person to watch it land in the trolley
            ui.showToast(added > 0 ? `${added} × ${product.name} added to your trolley` : "You already have the maximum quantity");
          }}
        />
      )}
    </>
  );
}

function PauseMenu({ touchMode, onEnter }: { touchMode: boolean; onEnter: () => void }) {
  const [sens, setSens] = useState<SensitivityId>(getSensitivity);
  const lockError = useStoreUi((s) => s.lockError);

  const enter = () => {
    resetTouchInput();
    unlockVoiceAudio();
    startStoreMusic(); // inside the click: browsers only allow audio after a user gesture
    if (touchMode) {
      // Immersive on Android/iPad; unsupported (iPhone) or refused → stays in the browser UI.
      const root = document.documentElement;
      if (!document.fullscreenElement && root.requestFullscreen) root.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    }
    onEnter();
  };

  return (
    <div className="fixed inset-0 z-20 flex overflow-y-auto bg-ink/55 p-4 backdrop-blur-sm">
      <div className="m-auto w-full max-w-md rounded-3xl bg-cream p-6 text-center shadow-2xl sm:p-8 short:grid short:max-w-3xl short:grid-cols-2 short:items-center short:gap-x-8 short:p-6">
        <div>
        <p className="text-xs uppercase tracking-[0.2em] text-ink-soft">Mega Market</p>
        <h1 className="mt-2 font-display text-3xl sm:text-4xl">Welcome in</h1>
        {touchMode ? (
          <>
            <dl className="mx-auto mt-5 grid max-w-xs grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-left text-sm short:mt-4">
              <dt className="font-medium">Left thumb</dt><dd className="text-ink-soft">Walk · push to the edge to run</dd>
              <dt className="font-medium">Right thumb</dt><dd className="text-ink-soft">Drag to look around</dd>
              <dt className="font-medium">✋ button</dt><dd className="text-ink-soft">Inspect the product in front of you</dd>
              <dt className="font-medium">Cart</dt><dd className="text-ink-soft">Review your cart</dd>
            </dl>
            <fieldset className="mt-5">
              <legend className="mb-2 text-xs uppercase tracking-wider text-ink-soft">Look sensitivity</legend>
              <div className="inline-flex rounded-full border border-sand bg-white/60 p-1">
                {SENSITIVITY_LEVELS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={sens === l.id}
                    onClick={() => {
                      setSensitivity(l.id);
                      setSens(l.id);
                    }}
                    className={`rounded-full px-4 py-2 text-sm transition ${sens === l.id ? "bg-ink text-cream" : "text-ink-soft"}`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </>
        ) : (
          <dl className="mx-auto mt-6 grid max-w-xs grid-cols-2 gap-x-4 gap-y-2 text-left text-sm">
            <dt className="font-medium">Mouse</dt><dd className="text-ink-soft">Look around</dd>
            <dt className="font-medium">W A S D</dt><dd className="text-ink-soft">Walk</dd>
            <dt className="font-medium">Shift</dt><dd className="text-ink-soft">Run</dd>
            <dt className="font-medium">E</dt><dd className="text-ink-soft">Pick up a product</dd>
            <dt className="font-medium">C</dt><dd className="text-ink-soft">Open cart</dd>
            <dt className="font-medium">M</dt><dd className="text-ink-soft">Music on / off</dd>
            <dt className="font-medium">V</dt><dd className="text-ink-soft">Mic on / off (talk)</dd>
            <dt className="font-medium">Esc</dt><dd className="text-ink-soft">Pause</dd>
          </dl>
        )}
        </div>
        <div>
        <button autoFocus onClick={enter} className="mt-6 w-full rounded-full bg-ink py-3.5 font-medium text-cream transition hover:bg-ink-soft sm:mt-8 short:mt-0">
          {touchMode ? "Tap to enter" : "Click to enter"}
        </button>
        {lockError && !touchMode && (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-800">{lockError}</p>
        )}
        <div className="mt-4 flex justify-center gap-6 text-sm">
          <Link href="/catalog" className="py-1 underline">Shop the list view</Link>
          <Link href="/" className="py-1 underline">Leave store</Link>
        </div>
        </div>
      </div>
    </div>
  );
}

function MusicToggle() {
  const muted = useSyncExternalStore(subscribeMusicMuted, isMusicMuted, () => false);
  return (
    <button
      type="button"
      onClick={toggleMusicMuted}
      aria-pressed={!muted}
      aria-label={muted ? "Turn music on" : "Turn music off"}
      title={muted ? "Music off (M)" : "Music on (M)"}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/70 text-cream shadow-lg ring-1 ring-cream/20 backdrop-blur transition hover:bg-ink"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" fill="currentColor" />
        <circle cx="18" cy="16" r="3" fill="currentColor" />
        {muted && <path d="M3 3l18 18" className="text-amber" stroke="currentColor" />}
      </svg>
    </button>
  );
}

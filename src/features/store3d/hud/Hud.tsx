"use client";

import { useEffect, useSyncExternalStore } from "react";
import { CartButton } from "@/components/CartButton";
import { MarketSwitch } from "@/components/MarketSwitch";
import { useCart } from "@/features/cart/cart-store";
import { interactWithTarget, openCartFromStore } from "../actions";
import { getMusicVolume, isMusicMuted, setMusicDucked, setMusicVolume, stopStoreMusic, subscribeMusicMuted, toggleMusicMuted } from "../music";
import type { StoreCatalog } from "../StoreScene";
import { addToTrolley } from "../trolley/addToTrolley";
import { useStoreUi } from "../ui-store";
import { ProductPanel } from "./ProductPanel";
import { ShopRentPanel } from "./ShopRentPanel";
import { TenantProductPanel } from "./TenantProductPanel";
import { PauseMenu } from "./PauseMenu";
import { ProductPeek } from "./ProductPeek";
import { TouchControls } from "./TouchControls";
import { SupportersScrollButtons } from "./SupportersScrollButtons";

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
  const openShopId = useStoreUi((s) => s.openShopId);
  const openTenantProduct = useStoreUi((s) => s.openTenantProduct);

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

  const showPause = ready && !locked && !product && !openShopId && !openTenantProduct && !cartOpen && !inspect;
  const showTouchControls = touchMode && ready && locked && !product && !openShopId && !openTenantProduct && !cartOpen && !inspect;

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
            <span className="truncate text-sm sm:text-base">{target.kind === "wheel" ? "Spin the lucky wheel" : target.kind === "tenantProduct" ? `See ${target.label}` : target.kind === "shop" ? (target.rented ? `${target.label} · rented` : `Rent ${target.label}`) : "Review cart & checkout"}</span>
          </div>
        </div>
      )}

      {locked && !touchMode && (
        <p className="pointer-events-none fixed bottom-4 left-4 z-10 text-xs text-ink/60">
          WASD move · Shift run · E interact · C cart · M music · V mic · Esc pause
        </p>
      )}

      {showTouchControls && <TouchControls />}
      {showTouchControls && <SupportersScrollButtons />}

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

      {openTenantProduct && (
        <TenantProductPanel
          shopId={openTenantProduct.shopId}
          productId={openTenantProduct.productId}
          shops={catalog.shops}
          onClose={(resume) => {
            useStoreUi.getState().openTenantProductPanel(null);
            if (resume) requestLock();
          }}
        />
      )}

      {openShopId && (
        <ShopRentPanel
          shopId={openShopId}
          shops={catalog.shops}
          onClose={(resume) => {
            useStoreUi.getState().openShop(null);
            if (resume) requestLock();
          }}
        />
      )}

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

/** Mute button + volume slider (both remembered in localStorage by music.ts). */
function MusicToggle() {
  const muted = useSyncExternalStore(subscribeMusicMuted, isMusicMuted, () => false);
  const volume = useSyncExternalStore(subscribeMusicMuted, getMusicVolume, () => 0.5);
  return (
    <div className="flex h-10 items-center gap-1 rounded-full bg-ink/70 pr-3 text-cream shadow-lg ring-1 ring-cream/20 backdrop-blur">
      <button
        type="button"
        onClick={toggleMusicMuted}
        aria-pressed={!muted}
        aria-label={muted ? "Turn music on" : "Turn music off"}
        title={muted ? "Music off (M)" : "Music on (M)"}
        className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-ink"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" fill="currentColor" />
          <circle cx="18" cy="16" r="3" fill="currentColor" />
          {muted && <path d="M3 3l18 18" className="text-amber" stroke="currentColor" />}
        </svg>
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={(e) => {
          setMusicVolume(Number(e.target.value));
          if (isMusicMuted()) toggleMusicMuted(); // moving the slider turns the music back on
        }}
        aria-label="Music volume"
        aria-valuetext={`${Math.round(volume * 100)}%`}
        title="Music volume"
        className={`h-1 w-20 cursor-pointer accent-amber transition-opacity ${muted ? "opacity-40" : ""}`}
      />
    </div>
  );
}

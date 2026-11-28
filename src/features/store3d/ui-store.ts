"use client";

import { create } from "zustand";

export type InteractionTarget =
  | { key: string; kind: "product"; productId: string; label: string }
  | { key: "checkout"; kind: "checkout"; label: string }
  | { key: "lucky-wheel"; kind: "wheel"; label: string }
  | { key: string; kind: "shop"; shopId: string; label: string; rented: boolean }
  /** A shop renter's product on their shelves (wing/TenantProducts). */
  | { key: string; kind: "tenantProduct"; productId: string; shopId: string; label: string };

interface StoreUiState {
  /** Player is in control (walking/looking): pointer-locked on desktop, touch controls active on touch. */
  locked: boolean;
  /** Touch controls (joystick, drag-to-look, action buttons) instead of pointer lock + keyboard. */
  touchMode: boolean;
  /** Scene (physics, fonts, assets) finished loading. */
  ready: boolean;
  /** What the crosshair is on (exactly one at a time). */
  target: InteractionTarget | null;
  openProductId: string | null;
  /** Rental shop info panel ("Rent this shop"). */
  openShopId: string | null;
  /** Shop renter's product panel (hud/TenantProductPanel). */
  openTenantProduct: { shopId: string; productId: string } | null;
  toast: { id: number; text: string } | null;
  /** Set when the browser refuses mouse capture (pointer lock); shown on the entry overlay. */
  lockError: string | null;
  /** Dev-only fixed camera (?cam=x,y,z,yawDeg,pitchDeg) for visual testing; disables player control. */
  inspect: boolean;
  /** The browser dropped the WebGL context (iOS does this under memory pressure or after backgrounding). */
  contextLost: boolean;
  /**
   * Homepage hero embed: "preview" = live 3D picture with a cinematic camera, "entering" = 3D fly-in to the
   * spawn point, "play" = normal store (the /store page is always "play").
   */
  stage: "preview" | "entering" | "play";
  /** Set by the homepage embed: "Leave store" returns to the hero instead of navigating. */
  onLeave: (() => void) | null;
  /** Shopper is choosing their avatar (Woman / Man) right after entering or from pause menu. */
  avatarPickerOpen: boolean;
  /** True once the shopper has picked their avatar this visit. */
  avatarChosen: boolean;
  setStage: (stage: "preview" | "entering" | "play") => void;
  showToast: (text: string) => void;
  /** Enter play: pointer lock on desktop; in touch mode simply activates the touch controls. */
  requestLock: () => void;
  /** Leave play (pause / open a UI): exits pointer lock on desktop. */
  releaseLock: () => void;
  setTouchMode: (v: boolean) => void;
  setLocked: (v: boolean) => void;
  setLockError: (msg: string | null) => void;
  setReady: (v: boolean) => void;
  setTarget: (t: InteractionTarget | null) => void;
  openProduct: (id: string | null) => void;
  openShop: (id: string | null) => void;
  openTenantProductPanel: (p: { shopId: string; productId: string } | null) => void;
  openAvatarPicker: (open: boolean) => void;
  confirmAvatarChoice: () => void;
  reset: () => void;
}

const initial = { locked: false, touchMode: false, ready: false, target: null, openProductId: null, openShopId: null, openTenantProduct: null, toast: null, lockError: null, inspect: false, contextLost: false, stage: "play" as const, onLeave: null, avatarPickerOpen: false, avatarChosen: false };

export const LOCK_ERROR_MESSAGE =
  "Your browser didn't allow mouse capture. Wait a second and click again, or shop from the list view.";
let toastSeq = 0;

export const useStoreUi = create<StoreUiState>()((set, get) => ({
  ...initial,
  requestLock: () => {},
  releaseLock: () => {
    if (!get().touchMode && typeof document !== "undefined" && document.pointerLockElement) document.exitPointerLock();
    else set({ locked: false });
  },
  setTouchMode: (touchMode) => set({ touchMode }),
  setLocked: (locked) => set(locked ? { locked, lockError: null } : { locked }),
  setLockError: (lockError) => set({ lockError }),
  setReady: (ready) => set({ ready }),
  setStage: (stage) => set({ stage }),
  setTarget: (target) => set({ target }),
  openProduct: (openProductId) => set({ openProductId, target: null }),
  openShop: (openShopId) => set({ openShopId, target: null }),
  openTenantProductPanel: (openTenantProduct) => set({ openTenantProduct, target: null }),
  openAvatarPicker: (avatarPickerOpen) => set({ avatarPickerOpen }),
  confirmAvatarChoice: () => set({ avatarPickerOpen: false, avatarChosen: true }),
  showToast: (text) => {
    const id = ++toastSeq;
    set({ toast: { id, text } });
    setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : s)), 2600);
  },
  reset: () => set(initial),
}));

"use client";

import { create } from "zustand";

export type InteractionTarget =
  | { key: string; kind: "product"; productId: string; label: string }
  | { key: "checkout"; kind: "checkout"; label: string };

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
  toast: { id: number; text: string } | null;
  /** Set when the browser refuses mouse capture (pointer lock); shown on the entry overlay. */
  lockError: string | null;
  /** Dev-only fixed camera (?cam=x,y,z,yawDeg,pitchDeg) for visual testing; disables player control. */
  inspect: boolean;
  /** The browser dropped the WebGL context (iOS does this under memory pressure or after backgrounding). */
  contextLost: boolean;
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
  reset: () => void;
}

const initial = { locked: false, touchMode: false, ready: false, target: null, openProductId: null, toast: null, lockError: null, inspect: false, contextLost: false };

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
  setTarget: (target) => set({ target }),
  openProduct: (openProductId) => set({ openProductId, target: null }),
  showToast: (text) => {
    const id = ++toastSeq;
    set({ toast: { id, text } });
    setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : s)), 2600);
  },
  reset: () => set(initial),
}));

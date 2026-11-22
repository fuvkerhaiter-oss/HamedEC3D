"use client";
/**
 * Tiny bridge between the 3D supporters panel and the DOM HUD: `near` (panel open in front of the shopper, so the
 * HUD shows the touch scroll buttons) and `nudge(rows)` (HUD buttons → panel scroll).
 */
import { create } from "zustand";

export const useSupportersScroll = create<{ near: boolean; scrollable: boolean; setNear: (near: boolean, scrollable: boolean) => void }>()((set) => ({
  near: false,
  scrollable: false,
  setNear: (near, scrollable) => set({ near, scrollable }),
}));

const listeners = new Set<(rows: number) => void>();
export function onSupportersNudge(fn: (rows: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function nudgeSupporters(rows: number): void {
  listeners.forEach((fn) => fn(rows));
}

"use client";

import * as THREE from "three";
import { create } from "zustand";
import type { Vec3 } from "../layout";

export interface Flight {
  key: string; // unit key `${variantId}#${n}`
  productId: string;
  /** World start point (shelf hit point); null = from just in front of the camera. */
  from: Vec3 | null;
  delay: number; // seconds
}

interface TrolleyState {
  flights: Flight[];
  launch: (flights: Flight[]) => void;
  land: (key: string) => void;
  clear: () => void;
}

export const useTrolley = create<TrolleyState>()((set) => ({
  flights: [],
  launch: (flights) => set((s) => ({ flights: [...s.flights.filter((f) => !flights.some((n) => n.key === f.key)), ...flights] })),
  land: (key) => set((s) => ({ flights: s.flights.filter((f) => f.key !== key) })),
  clear: () => set({ flights: [] }),
}));

/** Per-frame values shared between Player, Trolley and flights (mutable, never React state). */
export const trolleyMotion = { speed: 0, jiggle: 0 };
/** Trolley basket group (items are positioned in its local space). */
export const trolleyAnchor: { current: THREE.Object3D | null } = { current: null };
/** Where the crosshair last hit a product on a shelf. */
export const lastHit = { point: new THREE.Vector3(), productId: null as string | null };

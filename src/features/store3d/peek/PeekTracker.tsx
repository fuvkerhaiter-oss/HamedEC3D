"use client";

import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { lastHit } from "../trolley/trolley-store";
import { useStoreUi } from "../ui-store";

/** Screen-space data for the product peek callout, written every frame by PeekTracker (no React renders). */
export interface PeekFrame {
  /** Anchor on the product, in CSS px from the top-left of the viewport. */
  x: number;
  y: number;
  /** Anchor is in front of the camera and on screen. */
  onScreen: boolean;
  /** Smoothed camera turn rate (rad/s) → card parallax tilt. */
  yawRate: number;
  pitchRate: number;
}

type Listener = (f: PeekFrame) => void;
let listener: Listener | null = null;
/** The DOM card subscribes here; only one card exists. */
export function onPeekFrame(fn: Listener | null) {
  listener = fn;
}

const anchor = new THREE.Vector3();
const projected = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const frame: PeekFrame = { x: 0, y: 0, onScreen: false, yawRate: 0, pitchRate: 0 };
let anchorKey: string | null = null;
let lastYaw = 0;
let lastPitch = 0;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Tracks the product under the crosshair in 3D: pins an anchor on the exact point the crosshair hit
 * (captured once per product so it doesn't swim) and projects it to the screen for the callout.
 */
export function PeekTracker() {
  useFrame(({ camera, size }, delta) => {
    const target = useStoreUi.getState().target;
    const dt = Math.max(1e-3, Math.min(delta, 0.1));

    euler.setFromQuaternion(camera.quaternion, "YXZ");
    const k = 1 - Math.exp(-10 * dt);
    frame.yawRate += (wrap(euler.y - lastYaw) / dt - frame.yawRate) * k;
    frame.pitchRate += ((euler.x - lastPitch) / dt - frame.pitchRate) * k;
    lastYaw = euler.y;
    lastPitch = euler.x;

    if (target?.kind === "product" && target.key !== anchorKey && lastHit.productId === target.productId) {
      anchorKey = target.key;
      anchor.copy(lastHit.point);
    } else if (!target) {
      anchorKey = null;
    }
    if (!listener) return;

    projected.copy(anchor).project(camera);
    frame.onScreen = anchorKey !== null && projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
    frame.x = ((projected.x + 1) / 2) * size.width;
    frame.y = ((1 - projected.y) / 2) * size.height;
    listener(frame);
  });
  return null;
}

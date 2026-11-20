"use client";

import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useStoreUi } from "../ui-store";
import { LOOK_RADIANS_PER_PX, sensitivityMultiplier, touchInput } from "./touch-input";

const MAX_PITCH = THREE.MathUtils.degToRad(85);
const SMOOTHING = 28; // 1/s — light low-pass on drag input: removes touch jitter, ~35 ms of lag
const LEVEL_RESPONSE = 6;

const euler = new THREE.Euler(0, 0, 0, "YXZ");
let pendingX = 0;
let pendingY = 0;

/**
 * Drag-to-look for touch mode: applies the look deltas written by the touch overlay to the same camera
 * the desktop PointerLockControls rotates (yaw/pitch, YXZ, pitch clamped). Player then follows the
 * camera heading exactly as it does with the mouse.
 */
export function TouchLook() {
  useFrame(({ camera }, delta) => {
    const ui = useStoreUi.getState();
    if (!ui.touchMode || ui.inspect) return;
    pendingX += touchInput.lookDX;
    pendingY += touchInput.lookDY;
    touchInput.lookDX = 0;
    touchInput.lookDY = 0;
    if (!ui.locked || ui.openProductId) {
      pendingX = pendingY = 0;
      touchInput.levelView = false;
      return;
    }

    const dt = Math.min(delta, 0.1);
    const k = 1 - Math.exp(-SMOOTHING * dt);
    const dx = pendingX * k;
    const dy = pendingY * k;
    pendingX -= dx;
    pendingY -= dy;
    if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4 && !touchInput.levelView) return;

    const s = LOOK_RADIANS_PER_PX * sensitivityMultiplier();
    euler.setFromQuaternion(camera.quaternion, "YXZ");
    euler.y -= dx * s;
    euler.x = THREE.MathUtils.clamp(euler.x - dy * s, -MAX_PITCH, MAX_PITCH);
    if (touchInput.levelView) {
      euler.x *= Math.exp(-LEVEL_RESPONSE * dt);
      if (Math.abs(euler.x) < 0.002 || Math.abs(dy) > 0.5) {
        if (Math.abs(dy) <= 0.5) euler.x = 0;
        touchInput.levelView = false; // done, or the player took over the camera
      }
    }
    euler.z = 0;
    camera.quaternion.setFromEuler(euler);
  });
  return null;
}

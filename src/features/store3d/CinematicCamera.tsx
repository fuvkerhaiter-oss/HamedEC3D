"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { STORE_CONFIG } from "./env/supermarket";
import { prefersReducedMotion } from "./input/device";
import { useStoreUi } from "./ui-store";

const EYE_OFFSET = 0.75; // same as Player: camera = body centre + 0.75 m
const PLAY_FOV = 70;
const PREVIEW_FOV = 58;
const PEAK_FOV = 92; // lens "punch" mid-flight: the speed feeling of the woosh
export const FLY_MS = 1500;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Homepage embed camera. "preview": slow hovering shot from behind and above the entrance of the aisle.
 * "entering": a real 3D flight down to the shopper's eye position (swoop down + forward, FOV punch, slight
 * bank), ending exactly on the pose the Player continues from, then switches the stage to "play".
 */
export function CinematicCamera() {
  const calm = useRef<boolean | null>(null);
  const flight = useRef<{ t0: number; from: { x: number; y: number; z: number; pitch: number; yaw: number; fov: number } } | null>(null);

  useFrame((state) => {
    const camera = state.camera as THREE.PerspectiveCamera;
    const ui = useStoreUi.getState();
    if (ui.stage === "play" || ui.inspect) {
      flight.current = null;
      return;
    }
    const [sx, sy, sz] = STORE_CONFIG.spawn;
    const yaw = STORE_CONFIG.spawnYaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const eyeY = sy + EYE_OFFSET;
    calm.current ??= prefersReducedMotion(); // reduced motion: still preview, straight glide without punch/bank
    const still = calm.current;

    if (ui.stage === "preview") {
      const t = still ? 0 : state.clock.elapsedTime;
      const back = 3.0 + Math.sin(t * 0.21) * 0.2;
      const side = Math.sin(t * 0.13) * 0.35;
      camera.position.set(sx - fx * back - fz * side, eyeY + 1.15 + Math.sin(t * 0.27) * 0.06, sz - fz * back + fx * side);
      camera.rotation.set(-0.16 + Math.sin(t * 0.19) * 0.02, yaw + Math.sin(t * 0.11) * 0.07, 0, "YXZ");
      if (camera.fov !== PREVIEW_FOV) {
        camera.fov = PREVIEW_FOV;
        camera.updateProjectionMatrix();
      }
      return;
    }

    // entering
    const now = performance.now();
    if (!flight.current) {
      flight.current = {
        t0: now,
        from: { x: camera.position.x, y: camera.position.y, z: camera.position.z, pitch: camera.rotation.x, yaw: camera.rotation.y, fov: camera.fov },
      };
    }
    const { t0, from } = flight.current;
    const k = Math.min(1, (now - t0) / FLY_MS);
    const e = easeInOut(k);
    const swoop = still ? 0 : Math.sin(Math.PI * k); // 0 → 1 → 0
    camera.position.set(lerp(from.x, sx, e), lerp(from.y, eyeY, e) + swoop * 0.25, lerp(from.z, sz, e));
    camera.rotation.set(lerp(from.pitch, 0, e) - swoop * 0.05, from.yaw + wrap(yaw - from.yaw) * e, swoop * 0.05, "YXZ");
    camera.fov = still ? lerp(from.fov, PLAY_FOV, e) : k < 0.55 ? lerp(from.fov, PEAK_FOV, easeInOut(k / 0.55)) : lerp(PEAK_FOV, PLAY_FOV, easeInOut((k - 0.55) / 0.45));
    camera.updateProjectionMatrix();

    if (k >= 1) {
      camera.position.set(sx, eyeY, sz);
      camera.rotation.set(0, yaw, 0, "YXZ");
      camera.fov = PLAY_FOV;
      camera.updateProjectionMatrix();
      flight.current = null;
      ui.setStage("play");
      if (ui.touchMode) ui.setLocked(true); // touch: straight into play (desktop locked during the click)
    }
  });
  return null;
}

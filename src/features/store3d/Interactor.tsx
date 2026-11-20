"use client";

import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { interactionRegistry } from "./interactables";
import { lastHit } from "./trolley/trolley-store";
import { useStoreUi } from "./ui-store";

export const INTERACTION_RANGE = 2.8; // meters

const raycaster = new THREE.Raycaster();
raycaster.far = INTERACTION_RANGE;
const CENTER = new THREE.Vector2(0, 0);
let frame = 0;
/** NDC offsets probed (touch only) when the center ray finds nothing: nearest first. */
const AIM_ASSIST = [
  new THREE.Vector2(0, -0.07),
  new THREE.Vector2(0, 0.07),
  new THREE.Vector2(-0.06, 0),
  new THREE.Vector2(0.06, 0),
  new THREE.Vector2(0, -0.14),
];

function castFrom(ndc: THREE.Vector2, camera: THREE.Camera) {
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObjects(interactionRegistry.objects(), true)[0];
}

/** Crosshair raycast: picks exactly one interactable (or none) every few frames. */
export function Interactor() {
  useFrame(({ camera }) => {
    const ui = useStoreUi.getState();
    if (!ui.locked || ui.openProductId) {
      if (ui.target) ui.setTarget(null);
      return;
    }
    frame = (frame + 1) % 3;
    if (frame !== 0) return;

    let hit = castFrom(CENTER, camera);
    let next = hit ? interactionRegistry.resolve(hit.object) : null;
    // Touch aim assist: thumbs aim less precisely than a mouse, so also probe a small cone around the crosshair.
    if (!next && ui.touchMode) {
      for (const offset of AIM_ASSIST) {
        const h = castFrom(offset, camera);
        const t = h ? interactionRegistry.resolve(h.object) : null;
        if (t) {
          hit = h;
          next = t;
          break;
        }
      }
    }
    if (hit && next?.kind === "product") {
      lastHit.point.copy(hit.point); // start point for the shelf → trolley animation
      lastHit.productId = next.productId;
    }
    if ((next?.key ?? null) !== (ui.target?.key ?? null)) ui.setTarget(next);
  });
  return null;
}

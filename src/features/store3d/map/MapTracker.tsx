"use client";

import { useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { mapLive } from "./map-live";

const dir = new THREE.Vector3();

/** Inside the Canvas: copies the shopper's camera position + heading into mapLive for the minimap. */
export function MapTracker() {
  useFrame(({ camera }) => {
    camera.getWorldDirection(dir);
    const p = mapLive.player;
    p.x = camera.position.x;
    p.z = camera.position.z;
    p.yaw = Math.atan2(-dir.x, -dir.z);
    p.valid = true;
  });
  useEffect(
    () => () => {
      mapLive.player.valid = false;
      mapLive.bots.length = 0;
    },
    [],
  );
  return null;
}

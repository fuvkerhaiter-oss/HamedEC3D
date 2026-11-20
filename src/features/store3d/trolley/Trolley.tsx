"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { ASSETS } from "../assets/registry";
import { basketSlot, TROLLEY, unitJitter } from "./geometry";
import { trolleyAnchor, trolleyMotion, useTrolley } from "./trolley-store";
import { ITEM_BOX, itemMaterial, useBasketUnits, type TrolleyCatalog } from "./visuals";

/** Imported shopping trolley (registry: "trolley"), rendered in the player's rigid-body space. */
export function Trolley({ tc }: { tc: TrolleyCatalog }) {
  const asset = ASSETS.trolley;
  const { scene } = useGLTF(asset.url);
  const model = useMemo(() => {
    const s = scene.clone(true);
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = asset.castShadow;
        m.receiveShadow = asset.receiveShadow;
      }
    });
    return s;
  }, [scene, asset.castShadow, asset.receiveShadow]);

  const wobble = useRef<THREE.Group>(null);
  const basket = useRef<THREE.Group>(null);

  useEffect(() => {
    trolleyAnchor.current = basket.current;
    return () => {
      trolleyAnchor.current = null;
    };
  }, []);

  useFrame((state, delta) => {
    trolleyMotion.jiggle *= Math.exp(-5 * delta);
    const g = wobble.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const j = trolleyMotion.jiggle;
    const rolling = Math.min(1, Math.abs(trolleyMotion.speed) / 2);
    g.rotation.z = Math.sin(t * 38) * 0.03 * j + Math.sin(t * 9) * 0.004 * rolling;
    g.rotation.x = Math.sin(t * 31) * 0.012 * j;
    g.position.y = -Math.abs(Math.sin(t * 38)) * 0.01 * j + Math.sin(t * 17) * 0.002 * rolling;
  });

  return (
    <group position={TROLLEY.offsetFromPlayer}>
      <group ref={wobble}>
        <primitive object={model} scale={asset.scale} rotation={asset.rotation} position={asset.position} />
        <group ref={basket}>
          <BasketItems tc={tc} />
        </group>
      </group>
    </group>
  );
}

/** Items resting in the basket (one per cart unit, capped); units still in flight are hidden. */
function BasketItems({ tc }: { tc: TrolleyCatalog }) {
  const units = useBasketUnits(tc);
  const flights = useTrolley((s) => s.flights);
  const flying = useMemo(() => new Set(flights.map((f) => f.key)), [flights]);
  return (
    <>
      {units.map((u, i) => {
        const slot = basketSlot(i);
        const v = tc.visuals.get(u.productId);
        if (!slot || !v || flying.has(u.key)) return null;
        const h = v.h * TROLLEY.itemScale;
        const w = v.w * TROLLEY.itemScale;
        return (
          <mesh
            key={u.key}
            geometry={ITEM_BOX}
            material={itemMaterial(v.color)}
            position={[slot[0], slot[1] + h / 2, slot[2]]}
            rotation-y={unitJitter(u.key)}
            scale={[w, h, w]}
            castShadow
          />
        );
      })}
    </>
  );
}

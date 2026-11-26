"use client";

/**
 * Prizes shown under the lucky wheel (wheel-local coordinates: +z = in front of the wheel face): a PS5 (retail box +
 * console) on the left plinth and a GTA VI game case on a small stand on the right plinth. Real models
 * (ASSETS.ps5 / ASSETS.gta6Case, sources in /source); the PS5 is at real size, the game case is shown enlarged
 * (DISPLAY_CASE ×) so it reads from the aisle. Decoration only: nothing here is a product listing.
 */
import { useMemo } from "react";
import * as THREE from "three";
import { useGLTF, Text, RoundedBox } from "@react-three/drei";
import { ASSETS } from "../assets/registry";

useGLTF.preload(ASSETS.ps5.url);
useGLTF.preload(ASSETS.gta6Case.url);

const PLINTH_H = 0.3; // tall enough that the prizes show above the "coming soon" sign
const DISPLAY_CASE = 1.8;
const LABEL = "#f3e3b8";

/** A cloned part of a loaded model, shadows on. */
function usePart(url: string, name?: string): THREE.Object3D {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    const src = name ? scene.getObjectByName(name) : scene;
    if (!src) throw new Error(`${url}: no node "${name}"`);
    const o = src.clone(true);
    o.position.set(0, 0, 0);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    return o;
  }, [scene, url, name]);
}

/** The game case centred on its own bounding box (the export's origin is off to the side). */
function useCenteredCase(): { object: THREE.Object3D; size: THREE.Vector3 } {
  const { scene } = useGLTF(ASSETS.gta6Case.url);
  return useMemo(() => {
    const inner = scene.clone(true);
    inner.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    const box = new THREE.Box3().setFromObject(inner);
    const c = box.getCenter(new THREE.Vector3());
    inner.position.sub(c);
    const g = new THREE.Group();
    g.add(inner);
    return { object: g, size: box.getSize(new THREE.Vector3()) };
  }, [scene]);
}

function Plinth({ w, d, gold }: { w: number; d: number; gold: THREE.Material }) {
  return (
    <group>
      <RoundedBox args={[w, PLINTH_H, d]} radius={0.03} smoothness={3} position={[0, PLINTH_H / 2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#7d0a1b" roughness={0.8} />
      </RoundedBox>
      <mesh position={[0, PLINTH_H + 0.004, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[w - 0.04, d - 0.04]} />
        <meshStandardMaterial color="#1a0d10" roughness={0.9} />
      </mesh>
      <mesh position={[0, PLINTH_H - 0.012, 0]} material={gold}>
        <boxGeometry args={[w + 0.012, 0.02, d + 0.012]} />
      </mesh>
    </group>
  );
}

function PlinthLabel({ text, z }: { text: string; z: number }) {
  return (
    <Text position={[0, PLINTH_H * 0.42, z + 0.003]} fontSize={0.042} letterSpacing={0.18} color={LABEL} anchorX="center" anchorY="middle" fontWeight={700}>
      {text}
    </Text>
  );
}

export function WheelPrizes({ gold }: { gold: THREE.Material }) {
  const box = usePart(ASSETS.ps5.url, "box");
  const consoleBody = usePart(ASSETS.ps5.url, "console");
  const gta = useCenteredCase();
  const s = ASSETS.ps5.scale;
  const cs = ASSETS.gta6Case.scale * DISPLAY_CASE;
  const caseH = gta.size.z * cs; // lying flat: its height is along z
  const caseT = gta.size.y * cs;

  return (
    <group>
      {/* PS5: box + console on the left */}
      <group position={[-0.92, 0, 0.6]} rotation-y={0.22}>
        <Plinth w={0.86} d={0.5} gold={gold} />
        <PlinthLabel text="PLAYSTATION 5" z={0.25} />
        {/* the FBX has the box turned 45°: −π/4 brings its printed front (PS5 logo) to +z */}
        <primitive object={box} position={[-0.17, PLINTH_H, -0.02]} rotation-y={-Math.PI / 4} scale={s} />
        <primitive object={consoleBody} position={[0.25, PLINTH_H, 0.04]} rotation-y={-0.4} scale={s} />
      </group>

      {/* GTA VI: the case standing on a gold easel on the right */}
      <group position={[0.92, 0, 0.6]} rotation-y={-0.22}>
        <Plinth w={0.5} d={0.4} gold={gold} />
        <PlinthLabel text="GTA VI" z={0.2} />
        <group position={[0, PLINTH_H + 0.012, 0]} rotation-x={-0.16}>
          {/* stood upright (cover faces +z), bottom edge on the easel lip */}
          <group position={[0, caseH / 2 + 0.01, 0]} rotation-x={Math.PI / 2} scale={cs}>
            <primitive object={gta.object} />
          </group>
          <mesh position={[0, 0.012, caseT / 2 + 0.012]} material={gold} castShadow>
            <boxGeometry args={[0.2, 0.024, 0.018]} />
          </mesh>
        </group>
        <mesh position={[0, PLINTH_H + 0.12, -0.07]} rotation-x={0.35} material={gold} castShadow>
          <boxGeometry args={[0.02, 0.26, 0.012]} />
        </mesh>
      </group>
    </group>
  );
}

"use client";

/**
 * Decoration under the lucky wheel (wheel-local coordinates: +z = in front of the wheel face): two plinths with
 * plain, unbranded gift boxes built from primitives (original geometry, no third-party models or trademarks).
 * The wheel gives no prize (see lucky-wheel.ts), so nothing here names or depicts a real product.
 * Earlier versions showed branded console/game models; they were removed for IP reasons (see ASSET_INVENTORY.md).
 */
import * as THREE from "three";
import { Text, RoundedBox } from "@react-three/drei";

const PLINTH_H = 0.3; // tall enough that the boxes show above the "coming soon" sign
const LABEL = "#f3e3b8";

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

/** A wrapped box with a ribbon cross on top, standing on y = 0. */
function GiftBox({ size, color, ribbon, position, rotationY = 0 }: { size: [number, number, number]; color: string; ribbon: THREE.Material; position: [number, number, number]; rotationY?: number }) {
  const [w, h, d] = size;
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      <mesh position={[0, h / 2, 0]} material={ribbon}>
        <boxGeometry args={[w * 0.16, h + 0.004, d + 0.004]} />
      </mesh>
      <mesh position={[0, h / 2, 0]} material={ribbon}>
        <boxGeometry args={[w + 0.004, h + 0.004, d * 0.16]} />
      </mesh>
      <mesh position={[0, h + 0.03, 0]} rotation-z={Math.PI / 4} material={ribbon} castShadow>
        <torusGeometry args={[0.035, 0.012, 8, 16]} />
      </mesh>
    </group>
  );
}

export function WheelPrizes({ gold }: { gold: THREE.Material }) {
  return (
    <group>
      <group position={[-0.92, 0, 0.6]} rotation-y={0.22}>
        <Plinth w={0.86} d={0.5} gold={gold} />
        <PlinthLabel text="COMING SOON" z={0.25} />
        <GiftBox size={[0.34, 0.26, 0.3]} color="#1f6f4a" ribbon={gold} position={[-0.17, PLINTH_H, -0.02]} rotationY={-0.3} />
        <GiftBox size={[0.22, 0.18, 0.22]} color="#c8102e" ribbon={gold} position={[0.25, PLINTH_H, 0.04]} rotationY={0.4} />
      </group>
      <group position={[0.92, 0, 0.6]} rotation-y={-0.22}>
        <Plinth w={0.5} d={0.4} gold={gold} />
        <PlinthLabel text="COMING SOON" z={0.2} />
        <GiftBox size={[0.26, 0.22, 0.24]} color="#f2b705" ribbon={gold} position={[0, PLINTH_H, 0]} rotationY={0.15} />
      </group>
    </group>
  );
}

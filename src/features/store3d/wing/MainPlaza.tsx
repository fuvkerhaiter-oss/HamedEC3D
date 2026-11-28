"use client";

/**
 * Central concourse ("Grand Plaza") of the main store hall, replacing the removed supermarket gondola shelving.
 * Everything sits along the central spine (z ≈ 0.65) and stays low or open-through so every rental shop sign,
 * awning, and doorway along both side walls remains 100% visible from anywhere in the hall.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Text } from "@react-three/drei";
import { PLAZA_PROPS } from "../env/extension";
import { PrizeClawMachine } from "./PrizeClawMachine";

function usePlazaMaterials() {
  const m = useMemo(
    () => ({
      marble: new THREE.MeshStandardMaterial({ color: "#f3efe8", roughness: 0.25, metalness: 0.05 }),
      terrazzo: new THREE.MeshStandardMaterial({ color: "#e1dbd0", roughness: 0.45 }),
      brass: new THREE.MeshStandardMaterial({ color: "#f7c416", metalness: 0.72, roughness: 0.24 }),
      steel: new THREE.MeshStandardMaterial({ color: "#23272b", metalness: 0.78, roughness: 0.32 }),
      chrome: new THREE.MeshStandardMaterial({ color: "#dce1e6", metalness: 0.95, roughness: 0.14 }),
      oak: new THREE.MeshStandardMaterial({ color: "#b6895b", roughness: 0.55 }),
      led: new THREE.MeshBasicMaterial({ color: "#fff3c4", toneMapped: false }),
      amberGlow: new THREE.MeshBasicMaterial({ color: "#ffbe2e", toneMapped: false }),
      velvet: new THREE.MeshStandardMaterial({ color: "#b8142c", roughness: 0.75 }),
      white: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.35 }),
      duckYellow: new THREE.MeshPhysicalMaterial({ color: "#ffcf1f", roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.18 }),
      duckOrange: new THREE.MeshPhysicalMaterial({ color: "#ff7a12", roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
      eye: new THREE.MeshPhysicalMaterial({ color: "#0a0a0b", roughness: 0.05, clearcoat: 1 }),
      ink: new THREE.MeshStandardMaterial({ color: "#14181c", roughness: 0.6 }),
      bagPaper: new THREE.MeshPhysicalMaterial({ color: "#f5c22a", roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.5 }),
      bagFold: new THREE.MeshStandardMaterial({ color: "#c9981a", roughness: 0.6 }),
    }),
    [],
  );
  useLayoutEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m]);
  return m;
}
type Mats = ReturnType<typeof usePlazaMaterials>;

/** Rope handle of the shopping bag: a sagging arc of braided cord between two eyelets. */
function bagHandleGeometry(): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.12, 0, 0),
    new THREE.Vector3(-0.1, 0.16, 0),
    new THREE.Vector3(0, 0.23, 0),
    new THREE.Vector3(0.1, 0.16, 0),
    new THREE.Vector3(0.12, 0, 0),
  ]);
  return new THREE.TubeGeometry(curve, 32, 0.011, 8, false);
}

/** Centerpiece circular plaza island with a slowly turning, oversized premium shopping-bag sculpture. */
function CenterMascotPlaza({ mats }: { mats: Mats }) {
  const { x, z, radius } = PLAZA_PROPS.center;
  const mascot = useRef<THREE.Group>(null);
  const handle = useMemo(() => bagHandleGeometry(), []);
  useEffect(() => () => handle.dispose(), [handle]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (mascot.current) {
      mascot.current.position.y = 1.5 + Math.sin(t * 0.9) * 0.025;
      mascot.current.rotation.y = t * 0.25;
    }
  });
  return (
    <group position={[x, 0, z]}>
      {/* stepped circular marble base + warm LED underglow */}
      <mesh position={[0, 0.07, 0]} material={mats.terrazzo} receiveShadow>
        <cylinderGeometry args={[radius, radius + 0.08, 0.14, 48]} />
      </mesh>
      <mesh position={[0, 0.145, 0]} rotation-x={Math.PI / 2} material={mats.amberGlow}>
        <torusGeometry args={[radius - 0.04, 0.022, 10, 48]} />
      </mesh>
      {/* circular oak lounge ring */}
      <mesh position={[0, 0.42, 0]} material={mats.oak} castShadow receiveShadow>
        <cylinderGeometry args={[radius - 0.28, radius - 0.28, 0.08, 48]} />
      </mesh>
      <mesh position={[0, 0.26, 0]} material={mats.steel}>
        <cylinderGeometry args={[radius - 0.5, radius - 0.5, 0.24, 36]} />
      </mesh>
      {/* central trophy pedestal */}
      <mesh position={[0, 0.74, 0]} material={mats.marble} castShadow>
        <cylinderGeometry args={[0.62, 0.78, 0.62, 32]} />
      </mesh>
      <mesh position={[0, 1.07, 0]} material={mats.brass}>
        <cylinderGeometry args={[0.66, 0.66, 0.05, 32]} />
      </mesh>
      {/* GRAND PLAZA plaques */}
      {[-1, 1].map((s) => (
        <group key={s} position={[0, 0.74, s * 0.71]} rotation-y={s < 0 ? Math.PI : 0}>
          <RoundedBox args={[0.82, 0.2, 0.04]} radius={0.02} smoothness={2} material={mats.ink} />
          <Text position={[0, 0, 0.024]} fontSize={0.095} letterSpacing={0.14} color="#f7c416" anchorX="center" anchorY="middle" fontWeight={800}>
            GRAND PLAZA
          </Text>
        </group>
      ))}
      {/* oversized premium shopping bag sculpture (bottom rests just above the brass cap) */}
      <group ref={mascot} position={[0, 1.5, 0]}>
        {/* bag body: heavy coated paper, side gussets folded in */}
        <mesh material={mats.bagPaper} castShadow>
          <boxGeometry args={[0.6, 0.74, 0.28]} />
        </mesh>
        {[-1, 1].map((s) => (
          <group key={`g${s}`} position={[s * 0.301, 0, 0]}>
            {/* gusset crease */}
            <mesh rotation-y={Math.PI / 2} material={mats.bagFold}>
              <planeGeometry args={[0.012, 0.74]} />
            </mesh>
          </group>
        ))}
        {/* folded top cuff + dark interior */}
        <mesh position={[0, 0.355, 0]} material={mats.bagFold}>
          <boxGeometry args={[0.606, 0.03, 0.286]} />
        </mesh>
        <mesh position={[0, 0.371, 0]} rotation-x={-Math.PI / 2} material={mats.ink}>
          <planeGeometry args={[0.57, 0.25]} />
        </mesh>
        {/* rope handles with brass eyelets, front & back */}
        {[-1, 1].map((s) => (
          <group key={`h${s}`} position={[0, 0.33, s * 0.12]}>
            <mesh geometry={handle} material={mats.ink} castShadow />
            {[-0.12, 0.12].map((hx) => (
              <mesh key={hx} position={[hx, 0, s * 0.021]} rotation-x={Math.PI / 2} material={mats.brass}>
                <torusGeometry args={[0.016, 0.005, 8, 16]} />
              </mesh>
            ))}
          </group>
        ))}
        {/* printed brand on both faces */}
        {[-1, 1].map((s) => (
          <group key={`p${s}`} position={[0, 0, s * 0.141]} rotation-y={s < 0 ? Math.PI : 0}>
            <Text position={[0, 0.06, 0]} fontSize={0.085} letterSpacing={0.06} color="#14181c" anchorX="center" anchorY="middle" fontWeight={800}>
              WEGO SHIIIP
            </Text>
            <mesh position={[0, -0.01, 0]} material={mats.ink}>
              <planeGeometry args={[0.36, 0.006]} />
            </mesh>
            <Text position={[0, -0.06, 0]} fontSize={0.03} letterSpacing={0.18} color="#3a3020" anchorX="center" anchorY="middle">
              HAPPY FAMILY · HAPPY ANIMALS
            </Text>
          </group>
        ))}
      </group>
    </group>
  );
}

/** Giant glossy rubber-duck sculpture slowly turning on a VIP stage with velvet ropes. */
function VipDuckyStage({ mats }: { mats: Mats }) {
  const { x, z, radius } = PLAZA_PROPS.ducky;
  const duck = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (duck.current) {
      // turntable + a gentle "floating on water" rock
      duck.current.rotation.y = t * 0.3;
      duck.current.rotation.z = Math.sin(t * 1.1) * 0.025;
      duck.current.rotation.x = Math.sin(t * 0.8) * 0.02;
    }
  });
  const posts = [0, 1, 2, 3].map((i) => {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    return [Math.cos(a) * (radius - 0.12), Math.sin(a) * (radius - 0.12)] as const;
  });
  return (
    <group position={[x, 0, z]}>
      {/* glowing stage */}
      <mesh position={[0, 0.1, 0]} material={mats.steel} castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius + 0.08, 0.2, 40]} />
      </mesh>
      <mesh position={[0, 0.205, 0]} rotation-x={Math.PI / 2} material={mats.amberGlow}>
        <torusGeometry args={[radius - 0.05, 0.024, 10, 40]} />
      </mesh>
      {/* brass VIP stanchion posts + velvet rope ring */}
      {posts.map(([px, pz], i) => (
        <group key={i} position={[px, 0.2, pz]}>
          <mesh position={[0, 0.26, 0]} material={mats.brass}>
            <cylinderGeometry args={[0.025, 0.03, 0.52, 12]} />
          </mesh>
          <mesh position={[0, 0.54, 0]} material={mats.brass}>
            <sphereGeometry args={[0.045, 12, 10]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.64, 0]} rotation-x={Math.PI / 2} material={mats.velvet}>
        <torusGeometry args={[radius - 0.12, 0.022, 8, 40]} />
      </mesh>
      {/* sleek open-through arch with VIP DUCKY badge */}
      <mesh position={[0, 0.2, 0]} material={mats.amberGlow}>
        <torusGeometry args={[radius - 0.1, 0.032, 10, 36, Math.PI]} />
      </mesh>
      <group position={[0, radius + 0.12, 0]}>
        <RoundedBox args={[0.92, 0.24, 0.08]} radius={0.03} smoothness={2} material={mats.ink} />
        {[-1, 1].map((s) => (
          <Text key={s} position={[0, 0, s * 0.045]} rotation-y={s < 0 ? Math.PI : 0} fontSize={0.11} letterSpacing={0.14} color="#ffd22b" anchorX="center" anchorY="middle" fontWeight={800}>
            VIP DUCKY
          </Text>
        ))}
      </group>
      {/* classic rubber duck: rounded hull, raised tail, moulded wings, two-part bill, glossy eyes (+z = front) */}
      <group ref={duck} position={[0, 0.2, 0]}>
        {/* hull: wide flat-bottomed body + rounded chest */}
        <mesh position={[0, 0.36, -0.06]} scale={[0.92, 0.66, 1.2]} material={mats.duckYellow} castShadow>
          <sphereGeometry args={[0.5, 40, 28]} />
        </mesh>
        <mesh position={[0, 0.42, 0.24]} scale={[0.86, 0.84, 0.78]} material={mats.duckYellow} castShadow>
          <sphereGeometry args={[0.4, 36, 24]} />
        </mesh>
        {/* upswept tail */}
        <mesh position={[0, 0.56, -0.56]} rotation-x={0.75} scale={[0.5, 0.36, 0.62]} material={mats.duckYellow} castShadow>
          <sphereGeometry args={[0.34, 28, 20]} />
        </mesh>
        {/* moulded wings, flush with the hull */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.4, 0.48, -0.14]} rotation={[0.35, s * 0.12, s * -0.12]} scale={[0.16, 0.42, 0.78]} material={mats.duckYellow}>
            <sphereGeometry args={[0.4, 24, 18]} />
          </mesh>
        ))}
        {/* neck + head */}
        <mesh position={[0, 0.78, 0.16]} scale={[1, 0.8, 1]} material={mats.duckYellow}>
          <sphereGeometry args={[0.27, 28, 20]} />
        </mesh>
        <mesh position={[0, 1.0, 0.2]} scale={[1, 0.96, 1.02]} material={mats.duckYellow} castShadow>
          <sphereGeometry args={[0.32, 40, 28]} />
        </mesh>
        {/* bill: upper and lower mandible */}
        <mesh position={[0, 0.95, 0.5]} rotation-x={-0.12} scale={[1.2, 0.34, 1.15]} material={mats.duckOrange} castShadow>
          <sphereGeometry args={[0.15, 28, 18]} />
        </mesh>
        <mesh position={[0, 0.9, 0.46]} rotation-x={0.1} scale={[1.0, 0.26, 0.95]} material={mats.duckOrange}>
          <sphereGeometry args={[0.14, 24, 14]} />
        </mesh>
        {/* glossy oval eyes with a catch-light */}
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.15, 1.08, 0.44]} rotation-y={s * 0.42}>
            <mesh scale={[0.75, 1, 0.38]} material={mats.eye}>
              <sphereGeometry args={[0.055, 20, 14]} />
            </mesh>
            <mesh position={[s * -0.012, 0.022, 0.02]} material={mats.white}>
              <sphereGeometry args={[0.012, 10, 8]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/** Sleek oak-and-steel mall promenade bench. */
function PromenadeBench({ x, z, mats }: { x: number; z: number; mats: Mats }) {
  return (
    <group position={[x, 0, z]}>
      <RoundedBox args={[1.5, 0.07, 0.7]} radius={0.02} smoothness={2} position={[0, 0.44, 0]} material={mats.oak} castShadow receiveShadow />
      {[-0.58, 0.58].map((lx, i) => (
        <mesh key={i} position={[lx, 0.21, 0]} material={mats.steel} castShadow>
          <boxGeometry args={[0.08, 0.42, 0.62]} />
        </mesh>
      ))}
    </group>
  );
}

export function MainPlaza() {
  const mats = usePlazaMaterials();
  return (
    <group>
      <CenterMascotPlaza mats={mats} />
      <PrizeClawMachine />
      <VipDuckyStage mats={mats} />
      {PLAZA_PROPS.benches.map((b, i) => (
        <PromenadeBench key={i} x={b.x} z={b.z} mats={mats} />
      ))}
    </group>
  );
}

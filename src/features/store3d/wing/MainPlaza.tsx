"use client";

/**
 * Central concourse ("Grand Plaza") of the main store hall, replacing the removed supermarket gondola shelving.
 * Everything sits along the central spine (z ≈ 0.65) and stays low or open-through so every rental shop sign,
 * awning, and doorway along both side walls remains 100% visible from anywhere in the hall.
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Text } from "@react-three/drei";
import { PLAZA_PROPS } from "../env/extension";

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
      pinkGlow: new THREE.MeshBasicMaterial({ color: "#ff5ca8", toneMapped: false }),
      mintGlow: new THREE.MeshBasicMaterial({ color: "#2ee6c5", toneMapped: false }),
      coral: new THREE.MeshPhysicalMaterial({ color: "#ff5a36", roughness: 0.24, clearcoat: 0.85, clearcoatRoughness: 0.1 }),
      velvet: new THREE.MeshStandardMaterial({ color: "#b8142c", roughness: 0.75 }),
      cream: new THREE.MeshStandardMaterial({ color: "#fff6e3", roughness: 0.4 }),
      white: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.35 }),
      glass: new THREE.MeshStandardMaterial({ color: "#bfe3f2", metalness: 0.15, roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
      duckYellow: new THREE.MeshPhysicalMaterial({ color: "#ffd22b", roughness: 0.2, clearcoat: 0.95, clearcoatRoughness: 0.06 }),
      duckOrange: new THREE.MeshStandardMaterial({ color: "#ff7417", roughness: 0.32 }),
      shades: new THREE.MeshPhysicalMaterial({ color: "#111317", metalness: 0.6, roughness: 0.08, clearcoat: 1 }),
      ink: new THREE.MeshStandardMaterial({ color: "#14181c", roughness: 0.6 }),
      pink: new THREE.MeshStandardMaterial({ color: "#ff5c93", roughness: 0.3 }),
      mint: new THREE.MeshStandardMaterial({ color: "#2dd4bf", roughness: 0.3 }),
      sky: new THREE.MeshStandardMaterial({ color: "#38bdf8", roughness: 0.3 }),
      violet: new THREE.MeshStandardMaterial({ color: "#a855f7", roughness: 0.3 }),
    }),
    [],
  );
  useLayoutEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m]);
  return m;
}
type Mats = ReturnType<typeof usePlazaMaterials>;

/** Centerpiece circular plaza island with an animated waving, crowned Golden Shopping Bag Mascot. */
function CenterMascotPlaza({ mats }: { mats: Mats }) {
  const { x, z, radius } = PLAZA_PROPS.center;
  const mascot = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const stars = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (mascot.current) {
      mascot.current.position.y = 1.66 + Math.sin(t * 2.3) * 0.08;
      mascot.current.rotation.y = t * 0.55;
    }
    if (leftArm.current) leftArm.current.rotation.z = 0.4 + Math.sin(t * 5.2) * 0.45;
    if (rightArm.current) rightArm.current.rotation.z = -0.4 - Math.sin(t * 5.2 + 0.6) * 0.45;
    if (ring.current) {
      ring.current.rotation.z = t * 0.9;
      ring.current.rotation.x = Math.PI / 2 + Math.sin(t * 1.1) * 0.25;
    }
    if (stars.current) {
      stars.current.rotation.y = -t * 0.8;
      stars.current.children.forEach((c, i) => {
        c.position.y = Math.sin(t * 2.5 + i * 2) * 0.14;
      });
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
      {/* floating waving golden shopping bag mascot */}
      <group ref={mascot} position={[0, 1.66, 0]}>
        <RoundedBox args={[0.62, 0.68, 0.34]} radius={0.05} smoothness={3} material={mats.brass} castShadow />
        {/* tilted royal crown */}
        <group position={[0.14, 0.42, 0]} rotation-z={-0.18}>
          <mesh material={mats.amberGlow}>
            <cylinderGeometry args={[0.14, 0.1, 0.14, 6]} />
          </mesh>
          <mesh position={[0, 0.08, 0]} material={mats.pinkGlow}>
            <sphereGeometry args={[0.038, 10, 8]} />
          </mesh>
        </group>
        {/* bag handles */}
        {[-0.14, 0.14].map((bz, i) => (
          <mesh key={i} position={[0, 0.34, bz]} material={mats.chrome}>
            <torusGeometry args={[0.14, 0.024, 10, 24, Math.PI]} />
          </mesh>
        ))}
        {/* waving cartoon arms + white gloves */}
        <group ref={leftArm} position={[-0.33, 0.08, 0]}>
          <mesh position={[-0.12, 0.06, 0]} rotation-z={0.5} material={mats.ink}>
            <capsuleGeometry args={[0.028, 0.18, 6, 10]} />
          </mesh>
          <mesh position={[-0.22, 0.16, 0]} material={mats.white}>
            <sphereGeometry args={[0.065, 12, 10]} />
          </mesh>
        </group>
        <group ref={rightArm} position={[0.33, 0.08, 0]}>
          <mesh position={[0.12, 0.06, 0]} rotation-z={-0.5} material={mats.ink}>
            <capsuleGeometry args={[0.028, 0.18, 6, 10]} />
          </mesh>
          <mesh position={[0.22, 0.16, 0]} material={mats.white}>
            <sphereGeometry args={[0.065, 12, 10]} />
          </mesh>
        </group>
        {/* little cartoon sneakers */}
        {[-0.16, 0.16].map((fx, i) => (
          <group key={i} position={[fx, -0.4, 0.04]}>
            <RoundedBox args={[0.14, 0.09, 0.22]} radius={0.03} smoothness={2} material={mats.coral} />
            <mesh position={[0, -0.04, 0]} material={mats.white}>
              <boxGeometry args={[0.15, 0.025, 0.23]} />
            </mesh>
          </group>
        ))}
        {/* cheerful smiley on both faces */}
        {[-1, 1].map((s) => (
          <group key={s} position={[0, 0.02, s * 0.175]} rotation-y={s < 0 ? Math.PI : 0}>
            {[-0.11, 0.11].map((ex, i) => (
              <group key={i} position={[ex, 0.08, 0]}>
                <mesh material={mats.ink}>
                  <sphereGeometry args={[0.04, 12, 10]} />
                </mesh>
                <mesh position={[0.015, 0.015, 0.03]} material={mats.white}>
                  <sphereGeometry args={[0.014, 8, 6]} />
                </mesh>
              </group>
            ))}
            <mesh position={[0, -0.02, 0]} rotation-z={Math.PI} material={mats.ink}>
              <torusGeometry args={[0.1, 0.02, 8, 20, Math.PI * 0.8]} />
            </mesh>
          </group>
        ))}
      </group>
      {/* orbiting golden halo ring + twinkling stars */}
      <mesh ref={ring} position={[0, 1.66, 0]} material={mats.amberGlow}>
        <torusGeometry args={[0.72, 0.016, 10, 40]} />
      </mesh>
      <group ref={stars} position={[0, 1.66, 0]}>
        {[0, 1, 2].map((i) => {
          const a = (i * Math.PI * 2) / 3;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.88, 0, Math.sin(a) * 0.88]} material={mats.amberGlow}>
              <octahedronGeometry args={[0.075]} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

/** Retro-modern glass Prize Claw arcade cabinet with neon corner lights, dipping claw & cute prize capsules. */
function PrizeClawMachine({ mats }: { mats: Mats }) {
  const { x, z } = PLAZA_PROPS.claw;
  const capsules = useRef<THREE.Group>(null);
  const claw = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (claw.current) {
      claw.current.position.x = Math.sin(t * 0.85) * 0.36;
      claw.current.position.z = Math.cos(t * 0.65) * 0.3;
      // periodic playful dip toward the prizes
      const dip = Math.max(0, Math.sin(t * 1.4 - 1.0)) ** 3;
      claw.current.position.y = 1.98 - dip * 0.42;
    }
    if (capsules.current) {
      capsules.current.children.forEach((c, i) => {
        c.position.y = 1.15 + Math.abs(Math.sin(t * 2.2 + i * 1.1)) * 0.055;
        c.rotation.y = t * 0.7 + i;
      });
    }
  });
  const ballMats = [mats.pink, mats.mint, mats.sky, mats.violet, mats.brass];
  return (
    <group position={[x, 0, z]}>
      {/* base cabinet */}
      <RoundedBox args={[1.45, 0.96, 1.45]} radius={0.05} smoothness={2} position={[0, 0.48, 0]} material={mats.coral} castShadow receiveShadow />
      <mesh position={[0, 0.06, 0]} material={mats.steel}>
        <boxGeometry args={[1.48, 0.12, 1.48]} />
      </mesh>
      {/* prize drop chute & coin acceptor on both sides */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <RoundedBox args={[0.42, 0.34, 0.06]} radius={0.02} smoothness={2} position={[-0.25, 0.36, s * 0.72]} material={mats.steel} />
          <mesh position={[-0.25, 0.36, s * 0.74]} material={mats.chrome}>
            <boxGeometry args={[0.32, 0.24, 0.02]} />
          </mesh>
          <mesh position={[0.36, 0.56, s * 0.725]} material={mats.chrome}>
            <boxGeometry args={[0.14, 0.2, 0.03]} />
          </mesh>
          <mesh position={[0.36, 0.6, s * 0.742]} material={mats.amberGlow}>
            <boxGeometry args={[0.03, 0.08, 0.01]} />
          </mesh>
          {/* joystick & arcade buttons */}
          <group position={[0, 0.97, s * 0.62]}>
            <mesh position={[-0.22, 0.04, 0]} material={mats.chrome}>
              <cylinderGeometry args={[0.018, 0.018, 0.08, 10]} />
            </mesh>
            <mesh position={[-0.22, 0.09, 0]} material={mats.amberGlow}>
              <sphereGeometry args={[0.04, 12, 10]} />
            </mesh>
            <mesh position={[0.14, 0.015, 0]} material={mats.mintGlow}>
              <cylinderGeometry args={[0.04, 0.04, 0.03, 12]} />
            </mesh>
            <mesh position={[0.28, 0.015, 0]} material={mats.pinkGlow}>
              <cylinderGeometry args={[0.04, 0.04, 0.03, 12]} />
            </mesh>
          </group>
        </group>
      ))}
      {/* glass showcase */}
      <mesh position={[0, 1.56, 0]} material={mats.glass}>
        <boxGeometry args={[1.34, 1.16, 1.34]} />
      </mesh>
      {/* corner posts + neon light strips */}
      {([-1, 1] as const).flatMap((sx) =>
        ([-1, 1] as const).map((sz) => (
          <group key={`${sx}${sz}`} position={[sx * 0.67, 1.56, sz * 0.67]}>
            <mesh material={mats.cream}>
              <boxGeometry args={[0.07, 1.18, 0.07]} />
            </mesh>
            <mesh position={[sx * 0.032, 0, sz * 0.032]} material={sx === sz ? mats.pinkGlow : mats.mintGlow}>
              <cylinderGeometry args={[0.012, 0.012, 1.14, 8]} />
            </mesh>
          </group>
        )),
      )}
      {/* bobbing cute prize characters inside */}
      <group ref={capsules}>
        {[
          [-0.32, -0.25],
          [0.3, -0.3],
          [-0.28, 0.28],
          [0.32, 0.25],
          [0, 0],
        ].map(([bx, bz], i) => (
          <group key={i} position={[bx!, 1.15, bz!]}>
            <mesh material={ballMats[i % ballMats.length]}>
              <sphereGeometry args={[0.15, 16, 14]} />
            </mesh>
            {/* cute bunny/bear ears on top */}
            {[-0.07, 0.07].map((ex, j) => (
              <mesh key={j} position={[ex, 0.15, 0]} material={ballMats[i % ballMats.length]}>
                <sphereGeometry args={[0.05, 10, 8]} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      {/* animated chrome claw */}
      <group ref={claw} position={[0, 1.98, 0]}>
        <mesh position={[0, 0.14, 0]} material={mats.chrome}>
          <cylinderGeometry args={[0.014, 0.014, 0.34, 10]} />
        </mesh>
        <mesh position={[0, -0.04, 0]} material={mats.steel}>
          <cylinderGeometry args={[0.07, 0.05, 0.06, 12]} />
        </mesh>
        {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((a, i) => (
          <mesh key={i} position={[Math.cos(a) * 0.08, -0.14, Math.sin(a) * 0.08]} rotation-y={-a} rotation-z={0.35} material={mats.chrome}>
            <boxGeometry args={[0.02, 0.16, 0.02]} />
          </mesh>
        ))}
      </group>
      {/* illuminated marquee canopy */}
      <RoundedBox args={[1.48, 0.28, 1.48]} radius={0.04} smoothness={2} position={[0, 2.26, 0]} material={mats.coral} castShadow />
      {[-1, 1].map((s) => (
        <Text key={s} position={[0, 2.26, s * 0.746]} rotation-y={s < 0 ? Math.PI : 0} fontSize={0.14} letterSpacing={0.14} color="#fff7d6" anchorX="center" anchorY="middle" fontWeight={800}>
          PRIZE CLAW
        </Text>
      ))}
    </group>
  );
}

/** Giant cheerful Golden Ducky wearing cool sunglasses & a coral bowtie on a VIP stage with velvet ropes. */
function VipDuckyStage({ mats }: { mats: Mats }) {
  const { x, z, radius } = PLAZA_PROPS.ducky;
  const duck = useRef<THREE.Group>(null);
  const leftWing = useRef<THREE.Mesh>(null);
  const rightWing = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (duck.current) {
      duck.current.position.y = 0.22 + Math.abs(Math.sin(t * 2.4)) * 0.06;
      duck.current.rotation.y = Math.sin(t * 0.7) * 0.45 - Math.PI / 2;
    }
    const flap = Math.sin(t * 5.0) * 0.18;
    if (leftWing.current) leftWing.current.rotation.z = 0.25 + flap;
    if (rightWing.current) rightWing.current.rotation.z = -0.25 - flap;
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
      {/* giant golden duck with flapping wings, bowtie & sunglasses */}
      <group ref={duck} position={[0, 0.22, 0]}>
        <mesh position={[0, 0.45, -0.05]} scale={[1, 0.85, 1.2]} material={mats.duckYellow} castShadow>
          <sphereGeometry args={[0.52, 24, 20]} />
        </mesh>
        {/* flapping wings */}
        <mesh ref={leftWing} position={[-0.48, 0.48, -0.04]} scale={[0.35, 0.6, 1.1]} material={mats.duckYellow}>
          <sphereGeometry args={[0.36, 16, 12]} />
        </mesh>
        <mesh ref={rightWing} position={[0.48, 0.48, -0.04]} scale={[0.35, 0.6, 1.1]} material={mats.duckYellow}>
          <sphereGeometry args={[0.36, 16, 12]} />
        </mesh>
        {/* coral bowtie */}
        <group position={[0, 0.72, 0.45]}>
          <mesh position={[-0.08, 0, 0]} rotation-z={Math.PI / 2} material={mats.coral}>
            <coneGeometry args={[0.07, 0.14, 10]} />
          </mesh>
          <mesh position={[0.08, 0, 0]} rotation-z={-Math.PI / 2} material={mats.coral}>
            <coneGeometry args={[0.07, 0.14, 10]} />
          </mesh>
          <mesh material={mats.amberGlow}>
            <sphereGeometry args={[0.04, 10, 8]} />
          </mesh>
        </group>
        {/* tail */}
        <mesh position={[0, 0.62, -0.64]} rotation-x={-0.6} material={mats.duckYellow}>
          <coneGeometry args={[0.18, 0.34, 14]} />
        </mesh>
        {/* head */}
        <mesh position={[0, 1.05, 0.22]} material={mats.duckYellow} castShadow>
          <sphereGeometry args={[0.35, 24, 20]} />
        </mesh>
        {/* orange bill */}
        <mesh position={[0, 0.98, 0.56]} scale={[1.25, 0.55, 1.1]} material={mats.duckOrange}>
          <sphereGeometry args={[0.16, 16, 12]} />
        </mesh>
        {/* cool sunglasses + white shine */}
        {[-0.12, 0.12].map((lx, i) => (
          <group key={i} position={[lx, 1.1, 0.52]}>
            <mesh material={mats.shades}>
              <boxGeometry args={[0.17, 0.1, 0.04]} />
            </mesh>
            <mesh position={[-0.03, 0.02, 0.022]} rotation-z={0.5} material={mats.white}>
              <planeGeometry args={[0.06, 0.015]} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 1.11, 0.52]} material={mats.shades}>
          <boxGeometry args={[0.1, 0.03, 0.04]} />
        </mesh>
        {/* little crown */}
        <mesh position={[0, 1.42, 0.22]} material={mats.brass}>
          <cylinderGeometry args={[0.14, 0.1, 0.14, 6]} />
        </mesh>
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
      <PrizeClawMachine mats={mats} />
      <VipDuckyStage mats={mats} />
      {PLAZA_PROPS.benches.map((b, i) => (
        <PromenadeBench key={i} x={b.x} z={b.z} mats={mats} />
      ))}
    </group>
  );
}

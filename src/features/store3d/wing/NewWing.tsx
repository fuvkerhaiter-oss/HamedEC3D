"use client";

/**
 * The new hall + "Coming soon" wing beyond the old far wall (layout in ../env/extension.ts):
 * floor/ceiling continue with the imported store's own materials and tile mapping, the moved fridge banks line the
 * hall, and a portal with a big 3D "COMING SOON" title is chained shut (iron chain model, padlock). Walking up to the
 * chains opens the 3D updates board (./UpdatesBoard).
 */
import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Center, RoundedBox, Text, Text3D, useGLTF, useTexture } from "@react-three/drei";
import { ASSETS } from "../assets/registry";
import { GATE, GATE_X, NEW_END_X, OLD_END_X, WALL_T } from "../env/extension";
import type { EnvLayout } from "../env/types";
import { chainSegments, type ChainSpan } from "./chains";
import { UpdatesBoard } from "./UpdatesBoard";
import { SupportersBoard } from "./SupportersBoard";
import type { SupportersWall } from "@/lib/storefront/supporters";

const FLOOR_MATERIAL = "Material";
const CEILING_MATERIAL = "Material.001";
const WALL_MATERIAL = "Material.014";
const FONT_URL = "/fonts/helvetiker_bold.typeface.json";

const INK = "#0d1311";
const GREEN = "#12392b";
const AMBER = "#f7c416";

useGLTF.preload(ASSETS.chain.url);

export function NewWing({ env, lowPower, supporters }: { env: EnvLayout; lowPower: boolean; supporters?: SupportersWall }) {
  const z0 = env.interior.min[2];
  const z1 = env.interior.max[2];
  return (
    <group>
      <Architecture env={env} />
      <Gate z0={z0} z1={z1} ceiling={env.ceilingY} />
      <WingInterior z0={z0} z1={z1} ceiling={env.ceilingY} />
      <Suspense fallback={null}>
        <GateChains z0={z0} z1={z1} />
      </Suspense>
      <Suspense fallback={null}>
        <ComingSoonTitle z0={z0} z1={z1} />
      </Suspense>
      {!lowPower && <GateSpot from={[GATE_X - 5, env.ceilingY - 0.3, (z0 + z1) / 2]} to={[GATE_X, 1.6, (z0 + z1) / 2]} />}
      <UpdatesBoard center={[GATE_X - 2.5, 0, (z0 + z1) / 2 - 0.3]} gate={[GATE_X, (z0 + z1) / 2]} />
      <SupportersBoard wall={supporters} />
    </group>
  );
}

/** Warm spot on the chains and padlock (desktop only). Its target must be in the scene, or it aims at the origin. */
function GateSpot({ from, to }: { from: [number, number, number]; to: [number, number, number] }) {
  const target = useMemo(() => new THREE.Object3D(), []);
  return (
    <>
      <primitive object={target} position={to} />
      <spotLight position={from} target={target} angle={0.55} penumbra={0.8} intensity={28} distance={14} decay={1.6} color="#fff1cf" />
    </>
  );
}

// ───────────────────────────── architecture ─────────────────────────────

type Mapper = (a: number, b: number) => [number, number];

/** Affine UV mapping of a flat mesh of the imported store (uv = f(x, z)), so new surfaces continue its tiles. */
function planarUv(scene: THREE.Object3D, materialName: string): Mapper | null {
  let found: THREE.Mesh | null = null;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!found && m.isMesh && (m.material as THREE.Material).name === materialName) found = m;
  });
  const mesh = found as THREE.Mesh | null;
  const g = mesh?.geometry;
  const pos = g?.getAttribute("position");
  const uv = g?.getAttribute("uv");
  if (!g || !pos || !uv) return null;
  const idx = (k: number) => (g.index ? g.index.getX(k) : k);
  const p = [0, 1, 2].map((k) => [pos.getX(idx(k)), pos.getZ(idx(k)), 1]);
  const m = new THREE.Matrix3().set(p[0]![0]!, p[0]![1]!, 1, p[1]![0]!, p[1]![1]!, 1, p[2]![0]!, p[2]![1]!, 1);
  if (Math.abs(m.determinant()) < 1e-9) return null;
  const inv = m.clone().invert();
  const solve = (c: number) => new THREE.Vector3(uv.getComponent(idx(0), c), uv.getComponent(idx(1), c), uv.getComponent(idx(2), c)).applyMatrix3(inv);
  const cu = solve(0);
  const cv = solve(1);
  return (x, z) => [cu.x * x + cu.y * z + cu.z, cv.x * x + cv.y * z + cv.z];
}

/** Horizontal rectangle (x0..x1, z0..z1) at height y; `down` = faces the floor (ceiling). */
function flatRect(x0: number, x1: number, z0: number, z1: number, y: number, map: Mapper | null, down = false, tile = 2): THREE.BufferGeometry {
  const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as const;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(corners.flatMap(([x, z]) => [x, y, z]), 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(corners.flatMap(() => [0, down ? -1 : 1, 0]), 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(corners.flatMap(([x, z]) => (map ? map(x, z) : [x / tile, z / tile])), 2));
  g.setIndex(down ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  g.computeBoundingSphere();
  return g;
}

/** Bounding box of the imported mesh with this material (geometry is baked to world space by build_env.py). */
function materialBounds(scene: THREE.Object3D, name: string): THREE.Box3 | null {
  let box: THREE.Box3 | null = null;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!box && m.isMesh && (m.material as THREE.Material).name === name) {
      m.geometry.computeBoundingBox();
      box = m.geometry.boundingBox!.clone();
    }
  });
  return box;
}

function Architecture({ env }: { env: EnvLayout }) {
  const { scene, materials } = useGLTF(ASSETS.supermarket.url);
  const z0 = env.interior.min[2];
  const z1 = env.interior.max[2];
  const h = env.ceilingY;
  const x0 = OLD_END_X - 0.02;
  const wingX = GATE_X + GATE.pillarDepth / 2;

  const parts = useMemo(() => {
    const oldFloor = materialBounds(scene, FLOOR_MATERIAL);
    const oldCeiling = materialBounds(scene, CEILING_MATERIAL);
    const fy = oldFloor?.max.y ?? 0;
    // New surfaces start where the imported ones end (no overlapping, z-fighting strip).
    const floorX0 = Math.max(x0, oldFloor?.max.x ?? x0);
    const ceilX0 = Math.max(x0, oldCeiling?.max.x ?? x0);
    const floorMap = planarUv(scene, FLOOR_MATERIAL);
    const ceilMap = planarUv(scene, CEILING_MATERIAL);
    const wallSrc = materials[WALL_MATERIAL] as THREE.MeshStandardMaterial | undefined;
    const wall = wallSrc ? wallSrc.clone() : new THREE.MeshStandardMaterial({ color: "#cfcbc4", roughness: 0.9 });
    if (wall.map) {
      wall.map = wall.map.clone();
      wall.map.wrapS = wall.map.wrapT = THREE.RepeatWrapping;
      wall.map.needsUpdate = true;
    }
    return {
      fy,
      hallFloor: flatRect(floorX0, wingX, z0, z1, fy, floorMap),
      wingFloor: flatRect(wingX, NEW_END_X, z0, z1, fy, null, false, 3),
      ceiling: flatRect(ceilX0, NEW_END_X, z0, z1, h, ceilMap, true),
      wall,
    };
  }, [scene, materials, x0, wingX, z0, z1, h]);
  useLayoutEffect(() => () => {
    parts.hallFloor.dispose();
    parts.wingFloor.dispose();
    parts.ceiling.dispose();
    parts.wall.dispose();
  }, [parts]);

  const len = NEW_END_X - x0;
  const midX = (x0 + NEW_END_X) / 2;
  const floorMat = materials[FLOOR_MATERIAL];
  const ceilMat = materials[CEILING_MATERIAL];
  return (
    <group>
      <mesh geometry={parts.hallFloor} material={floorMat} receiveShadow />
      <mesh geometry={parts.wingFloor} receiveShadow>
        <meshStandardMaterial color="#3a3f3c" roughness={0.35} metalness={0.05} />
      </mesh>
      <mesh geometry={parts.ceiling} material={ceilMat} />
      {/* Side walls + new far wall (inner faces), same plaster as the store. */}
      <WallPlane material={parts.wall} position={[midX, h / 2, z0]} size={[len, h]} rotationY={0} />
      <WallPlane material={parts.wall} position={[midX, h / 2, z1]} size={[len, h]} rotationY={Math.PI} />
      <mesh position={[NEW_END_X + WALL_T / 2, h / 2, (z0 + z1) / 2]}>
        <boxGeometry args={[WALL_T, h, z1 - z0 + 2 * WALL_T]} />
        <meshStandardMaterial color={GREEN} roughness={0.8} />
      </mesh>
      {/* Skirting along the new walls. */}
      {[z0 + 0.01, z1 - 0.01].map((z) => (
        <mesh key={z} position={[midX, parts.fy + 0.06, z]}>
          <boxGeometry args={[len, 0.12, 0.02]} />
          <meshStandardMaterial color="#2b2f2d" roughness={0.6} />
        </mesh>
      ))}
      <CeilingLights x0={x0 + 0.8} x1={GATE_X - 0.8} z0={z0} z1={z1} y={h - 0.02} />
      <CeilingLights x0={wingX + 0.8} x1={NEW_END_X - 0.8} z0={z0} z1={z1} y={h - 0.02} dim />
    </group>
  );
}

function WallPlane({ material, position, size, rotationY }: { material: THREE.Material; position: [number, number, number]; size: [number, number]; rotationY: number }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(size[0], size[1]);
    // World-scale UVs (≈ 2 m per texture repeat) so the plaster grain matches the old walls.
    const uv = g.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * size[0]) / 2, (uv.getY(i) * size[1]) / 2);
    return g;
  }, [size]);
  useLayoutEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={material} position={position} rotation-y={rotationY} receiveShadow />;
}

/** Long LED batten rows like the store's, emissive only (no extra lights); two instanced meshes per call. */
function CeilingLights({ x0, x1, z0, z1, y, dim = false }: { x0: number; x1: number; z0: number; z1: number; y: number; dim?: boolean }) {
  const housing = useRef<THREE.InstancedMesh>(null);
  const lens = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => {
    const rows = [z0 + 2.4, (z0 + z1) / 2 - 2.4, (z0 + z1) / 2 + 2.4, z1 - 2.4];
    const len = x1 - x0;
    const count = Math.max(1, Math.round(len / 3.2));
    return { piece: len / count - 0.6, at: rows.flatMap((z) => Array.from({ length: count }, (_, i) => [x0 + (i + 0.5) * (len / count), z] as const)) };
  }, [x0, x1, z0, z1]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    spots.at.forEach(([x, z], i) => {
      housing.current?.setMatrixAt(i, m.makeTranslation(x, y - 0.04, z));
      lens.current?.setMatrixAt(i, m.makeTranslation(x, y - 0.075, z));
    });
    for (const im of [housing.current, lens.current]) {
      if (!im) continue;
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
  }, [spots, y]);
  return (
    <group>
      <instancedMesh ref={housing} args={[undefined, undefined, spots.at.length]} raycast={() => null}>
        <boxGeometry args={[spots.piece, 0.06, 0.2]} />
        <meshStandardMaterial color="#d9d9d6" metalness={0.6} roughness={0.35} />
      </instancedMesh>
      <instancedMesh ref={lens} args={[undefined, undefined, spots.at.length]} raycast={() => null}>
        <boxGeometry args={[spots.piece - 0.06, 0.012, 0.13]} />
        <meshStandardMaterial color="#ffffff" emissive={dim ? "#ffe9b0" : "#ffffff"} emissiveIntensity={dim ? 0.9 : 1.6} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

// ───────────────────────────── portal ─────────────────────────────

function Gate({ z0, z1, ceiling }: { z0: number; z1: number; ceiling: number }) {
  const w = z1 - z0;
  const zc = (z0 + z1) / 2;
  const d = GATE.pillarDepth;
  const pw = GATE.pillarWidth;
  const bh = ceiling - GATE.bulkheadBottom;
  const stripe = useHazardTexture();
  return (
    <group>
      {/* Bulkhead carrying the title. */}
      <mesh position={[GATE_X, GATE.bulkheadBottom + bh / 2, zc]} castShadow>
        <boxGeometry args={[d, bh, w]} />
        <meshStandardMaterial color={GREEN} roughness={0.55} metalness={0.15} />
      </mesh>
      {/* Lit amber reveal under the bulkhead + thin top line. */}
      <mesh position={[GATE_X - d / 2 - 0.006, GATE.bulkheadBottom + 0.05, zc]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[w, 0.05]} />
        <meshStandardMaterial color={AMBER} emissive={AMBER} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      <mesh position={[GATE_X - d / 2 - 0.006, ceiling - 0.12, zc]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[w, 0.02]} />
        <meshStandardMaterial color={AMBER} emissive={AMBER} emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      {/* Pillars with a hazard band. */}
      {[z0 + pw / 2, z1 - pw / 2].map((z) => (
        <group key={z} position={[GATE_X, 0, z]}>
          <mesh position={[0, GATE.bulkheadBottom / 2, 0]} castShadow>
            <boxGeometry args={[d, GATE.bulkheadBottom, pw]} />
            <meshStandardMaterial color={INK} roughness={0.45} metalness={0.3} />
          </mesh>
          <mesh position={[-d / 2 - 0.004, 0.55, 0]} rotation-y={-Math.PI / 2}>
            <planeGeometry args={[pw, 0.9]} />
            <meshStandardMaterial map={stripe} roughness={0.6} />
          </mesh>
          {/* Vertical light seam on the pillar face. */}
          <mesh position={[-d / 2 - 0.004, 2.2, 0]} rotation-y={-Math.PI / 2}>
            <planeGeometry args={[0.04, 2.1]} />
            <meshStandardMaterial color={AMBER} emissive={AMBER} emissiveIntensity={1.8} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {/* Hazard line on the floor in front of the chains. */}
      <mesh position={[GATE_X - 0.75, 0.1, zc]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.35, w - 2 * pw]} />
        <meshStandardMaterial map={stripe} roughness={0.7} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
    </group>
  );
}

/** Yellow/black diagonal stripes, drawn once on a small canvas. */
function useHazardTexture(): THREE.Texture {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = AMBER;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#111";
    for (let i = -128; i < 256; i += 64) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 32, 0);
      g.lineTo(i + 32 + 128, 128);
      g.lineTo(i + 128, 128);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(4, 1);
    t.anisotropy = 4;
    return t;
  }, []);
  useLayoutEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

function ComingSoonTitle({ z0, z1 }: { z0: number; z1: number }) {
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  const face = GATE_X - GATE.pillarDepth / 2;
  const zc = (z0 + z1) / 2;
  const y = GATE.bulkheadBottom + (5.87 - GATE.bulkheadBottom) / 2 + 0.05;
  // Slow "breathing" of the letter glow.
  useFrame(({ clock }) => {
    if (glow.current) glow.current.emissiveIntensity = 0.55 + 0.2 * Math.sin(clock.elapsedTime * 1.6);
  });
  return (
    <group position={[face - 0.02, y, zc]} rotation-y={-Math.PI / 2}>
      <Center>
        <Text3D font={FONT_URL} size={1.02} height={0.24} curveSegments={8} bevelEnabled bevelThickness={0.035} bevelSize={0.022} bevelSegments={4} letterSpacing={0.06} castShadow>
          COMING SOON
          <meshStandardMaterial ref={glow} color={AMBER} emissive="#ffb300" emissiveIntensity={0.6} metalness={0.55} roughness={0.28} />
        </Text3D>
      </Center>
      <Text position={[0, -0.92, 0.05]} fontSize={0.2} letterSpacing={0.35} color="#f7f4ee" anchorX="center" anchorY="middle">
        NEW WING · WEGO SHIIIP
      </Text>
    </group>
  );
}

// ───────────────────────────── chains + padlock ─────────────────────────────

const CHAIN_SEGMENT = 0.72;

function GateChains({ z0, z1 }: { z0: number; z1: number }) {
  const { scene } = useGLTF(ASSETS.chain.url);
  const ref = useRef<THREE.InstancedMesh>(null);
  const pw = GATE.pillarWidth;
  const x = GATE_X - GATE.pillarDepth / 2 - 0.12;
  const zl = z0 + pw;
  const zr = z1 - pw;
  const zc = (z0 + z1) / 2;
  const spans = useMemo<ChainSpan[]>(
    () => [
      { from: [x - 0.04, 3.2, zl + 0.05], to: [x - 0.04, 0.45, zr - 0.05], sag: 0.3 },
      { from: [x + 0.04, 3.2, zr - 0.05], to: [x + 0.04, 0.45, zl + 0.05], sag: 0.3 },
      // Low cordon chain between the pillars.
      { from: [x - 0.12, 1.05, zl + 0.05], to: [x - 0.12, 1.05, zr - 0.05], sag: 0.42 },
    ],
    [x, zl, zr],
  );
  const segments = useMemo(() => spans.flatMap((s) => chainSegments(s, CHAIN_SEGMENT)), [spans]);
  const { geometry, material } = useMemo(() => {
    let mesh: THREE.Mesh | null = null;
    scene.traverse((o) => {
      if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
    });
    const m = mesh as unknown as THREE.Mesh;
    return { geometry: m.geometry, material: m.material as THREE.Material };
  }, [scene]);

  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const roll = new THREE.Quaternion();
    const xAxis = new THREE.Vector3(1, 0, 0);
    const dir = new THREE.Vector3();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    segments.forEach((seg, i) => {
      q.setFromUnitVectors(xAxis, dir.set(...seg.dir));
      // Alternate a quarter turn around the chain axis so consecutive copies don't line up flat.
      roll.setFromAxisAngle(xAxis, i % 2 ? Math.PI / 2 : 0);
      q.multiply(roll);
      im.setMatrixAt(i, mat.compose(p.set(...seg.position), q, s.setScalar(seg.scale)));
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [segments]);

  // Anchor points of the chains.
  const anchors: [number, number, number][] = [
    [x, 3.2, zl], [x, 0.45, zl], [x, 3.2, zr], [x, 0.45, zr], [x - 0.08, 1.05, zl], [x - 0.08, 1.05, zr],
  ];
  // Crossing of the two diagonals (where the padlock hangs).
  const crossY = (3.2 + 0.45) / 2 - 0.3;
  return (
    <group>
      <instancedMesh ref={ref} args={[geometry, material, segments.length]} castShadow raycast={() => null} />
      {anchors.map((a, i) => (
        <group key={i} position={a}>
          <mesh position={[0.07, 0, 0]}>
            <boxGeometry args={[0.03, 0.22, 0.22]} />
            <meshStandardMaterial color="#5d6166" metalness={0.9} roughness={0.35} />
          </mesh>
          <mesh rotation-y={Math.PI / 2}>
            <torusGeometry args={[0.05, 0.014, 8, 20]} />
            <meshStandardMaterial color="#8d9196" metalness={1} roughness={0.25} />
          </mesh>
        </group>
      ))}
      <Padlock position={[x - 0.16, crossY - 0.22, zc]} />
    </group>
  );
}

function Padlock({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  // Hangs from the chain crossing and sways a little.
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.x = Math.sin(clock.elapsedTime * 1.1) * 0.06;
  });
  return (
    <group position={position}>
      <group ref={ref}>
        <mesh position={[0, 0.2, 0]} rotation-y={Math.PI / 2}>
          <torusGeometry args={[0.085, 0.022, 12, 28, Math.PI]} />
          <meshStandardMaterial color="#c9ccd1" metalness={1} roughness={0.18} />
        </mesh>
        {[-0.085, 0.085].map((z) => (
          <mesh key={z} position={[0, 0.16, z]}>
            <cylinderGeometry args={[0.022, 0.022, 0.09, 12]} />
            <meshStandardMaterial color="#c9ccd1" metalness={1} roughness={0.18} />
          </mesh>
        ))}
        <RoundedBox args={[0.12, 0.26, 0.3]} radius={0.03} smoothness={3} position={[0, 0, 0]} castShadow>
          <meshStandardMaterial color="#c99a1e" metalness={1} roughness={0.3} />
        </RoundedBox>
        <mesh position={[-0.062, -0.02, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.026, 0.026, 0.01, 16]} />
          <meshStandardMaterial color="#1b1b1b" metalness={0.6} roughness={0.5} />
        </mesh>
        <mesh position={[-0.064, -0.06, 0]}>
          <boxGeometry args={[0.01, 0.05, 0.014]} />
          <meshStandardMaterial color="#1b1b1b" />
        </mesh>
      </group>
    </group>
  );
}

// ───────────────────────────── the closed wing ─────────────────────────────

const BRAND_LOGO_URL = "/brand/wego-logo-glossy.webp";

/** Glossy WeGo SHIIIP logo (transparent WebP) on a flat plane, aspect kept from the image. */
function BrandLogo({ position, height }: { position: [number, number, number]; height: number }) {
  const tex = useTexture(BRAND_LOGO_URL, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
  });
  const img = tex.image as { width: number; height: number };
  const width = height * (img.width / img.height);
  return (
    <mesh position={position}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={tex} transparent alphaTest={0.02} toneMapped={false} />
    </mesh>
  );
}

function WingInterior({ z0, z1, ceiling }: { z0: number; z1: number; ceiling: number }) {
  const zc = (z0 + z1) / 2;
  const x0 = GATE_X + GATE.pillarDepth / 2;
  const depth = NEW_END_X - x0;
  return (
    <group>
      {/* Far wall: backlit brand panel. */}
      <group position={[NEW_END_X - 0.02, 0, zc]} rotation-y={-Math.PI / 2}>
        <mesh position={[0, 2.6, 0]}>
          <planeGeometry args={[9.5, 3.2]} />
          <meshStandardMaterial color="#173f31" roughness={0.6} />
        </mesh>
        <mesh position={[0, 2.6, -0.005]}>
          <planeGeometry args={[9.7, 3.4]} />
          <meshStandardMaterial color={AMBER} emissive={AMBER} emissiveIntensity={1.2} toneMapped={false} />
        </mesh>
        <Suspense fallback={null}>
          <BrandLogo position={[0, 3.2, 0.012]} height={1.7} />
        </Suspense>
        <Text position={[0, 2.2, 0.01]} fontSize={0.26} letterSpacing={0.25} color={AMBER} anchorX="center" anchorY="middle">
          HAPPY FAMILY · HAPPY ANIMALS
        </Text>
        <Text position={[0, 1.6, 0.01]} fontSize={0.17} letterSpacing={0.3} color="#cfd8d3" anchorX="center" anchorY="middle">
          NEW DEPARTMENTS — OPENING SOON
        </Text>
      </group>
      {/* Covered display islands waiting for their products. */}
      {[
        [x0 + depth * 0.3, zc - 3.2],
        [x0 + depth * 0.3, zc + 3.2],
        [x0 + depth * 0.62, zc],
      ].map(([x, z], i) => (
        <group key={i} position={[x!, 0, z!]}>
          <RoundedBox args={[2.6, 1.05, 1.5]} radius={0.12} smoothness={3} position={[0, 0.6, 0]} castShadow receiveShadow>
            <meshStandardMaterial color="#e9e6df" roughness={0.95} />
          </RoundedBox>
          <mesh position={[0, 0.07, 0]}>
            <boxGeometry args={[2.75, 0.06, 1.65]} />
            <meshStandardMaterial color="#2b2f2d" roughness={0.6} />
          </mesh>
        </group>
      ))}
      {/* Stacked crates and a pallet. */}
      {[
        [x0 + 1.2, z0 + 1.0, 0, 0.2],
        [x0 + 1.25, z0 + 1.0, 0.62, -0.15],
        [x0 + 2.0, z0 + 1.05, 0, 0.05],
        [NEW_END_X - 1.4, z1 - 1.1, 0, 0.35],
        [NEW_END_X - 2.1, z1 - 1.0, 0, -0.1],
        [NEW_END_X - 1.75, z1 - 1.05, 0.62, 0.15],
      ].map(([x, z, y, r], i) => (
        <mesh key={i} position={[x!, 0.42 + y!, z!]} rotation-y={r!} castShadow receiveShadow>
          <boxGeometry args={[0.62, 0.6, 0.62]} />
          <meshStandardMaterial color={i % 2 ? "#b88a55" : "#a77a48"} roughness={0.85} />
        </mesh>
      ))}
      {/* Work lights on tripods. */}
      {[
        [x0 + 2.2, z1 - 1.4, -2.4],
        [NEW_END_X - 2.5, z0 + 1.6, 0.9],
      ].map(([x, z, r], i) => (
        <group key={i} position={[x!, 0, z!]} rotation-y={r!}>
          {[0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((a) => (
            <mesh key={a} position={[Math.cos(a) * 0.22, 0.75, Math.sin(a) * 0.22]} rotation={[Math.sin(a) * 0.28, 0, -Math.cos(a) * 0.28]}>
              <cylinderGeometry args={[0.015, 0.015, 1.55, 6]} />
              <meshStandardMaterial color="#222" metalness={0.6} roughness={0.4} />
            </mesh>
          ))}
          <mesh position={[0, 1.62, 0]}>
            <boxGeometry args={[0.12, 0.34, 0.46]} />
            <meshStandardMaterial color="#1a1a1a" metalness={0.4} roughness={0.5} />
          </mesh>
          <mesh position={[-0.065, 1.62, 0]} rotation-y={-Math.PI / 2}>
            <planeGeometry args={[0.4, 0.28]} />
            <meshStandardMaterial color="#fff6dc" emissive="#fff1c4" emissiveIntensity={2.4} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {/* Wing ceiling drop: darker panel so the closed wing reads as "not open yet". */}
      <mesh position={[x0 + depth / 2, ceiling - 0.01, zc]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[depth, z1 - z0]} />
        <meshStandardMaterial color="#3d4240" roughness={0.9} side={THREE.FrontSide} />
      </mesh>
    </group>
  );
}

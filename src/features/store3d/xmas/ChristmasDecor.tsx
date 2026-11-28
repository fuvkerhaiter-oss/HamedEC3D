"use client";

/**
 * Christmas decoration of the big store (placements in ../env/christmas.ts). Every model is merged per material once
 * (the tree alone is 400 meshes in the source) and repeated props are drawn as InstancedMeshes, so the whole
 * decoration costs a few dozen draw calls. Bulbs and the tree's fairy lights twinkle; snow falls over the store.
 */
import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text, useGLTF } from "@react-three/drei";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { EnvLayout } from "../env/types";
import {
  XMAS_BANNER,
  XMAS_END_CAPS,
  XMAS_LIGHT_SPANS,
  XMAS_ORNAMENTS,
  XMAS_SANTA,
  XMAS_SLEIGH,
  XMAS_SNOWMEN,
  XMAS_TREE,
  XMAS_WALL_WREATHS,
  type XmasProp,
} from "../env/christmas";

const URL = {
  tree: "/models/xmas/tree.opt.glb",
  sleigh: "/models/xmas/sleigh.opt.glb",
  santa: "/models/xmas/model.opt.glb",
  snowman: "/models/xmas/snowman.opt.glb",
  wreath: "/models/xmas/wreath.opt.glb",
  lights: "/models/xmas/lights.opt.glb",
  decorations: "/models/xmas/decorations.opt.glb",
} as const;

export function ChristmasDecor({ env, lowPower }: { env: EnvLayout; lowPower: boolean }) {
  const root = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    root.current?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      const tw = m?.userData?.twinkle as { base: number; phase: number } | undefined;
      if (tw) m!.emissiveIntensity = tw.base * (0.55 + 0.45 * Math.max(0, Math.sin(t * 1.6 + tw.phase)));
    });
  });
  return (
    <group name="christmas-decor" ref={root}>
      <Suspense fallback={null}>
        <TreePlaza lowPower={lowPower} />
      </Suspense>
      <Suspense fallback={null}>
        <FloorProps />
      </Suspense>
      <Suspense fallback={null}>
        <Wreaths />
      </Suspense>
      <Suspense fallback={null}>
        <StringLights />
      </Suspense>
      <Suspense fallback={null}>
        <WallDecorations lowPower={lowPower} />
      </Suspense>
      <Banner />
      <Snowfall env={env} count={lowPower ? 500 : 1400} />
    </group>
  );
}

// ───────────────────────────── merging + instancing ─────────────────────────────

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/** Plain float copy (meshopt/quantized attributes → Float32) with only the attributes we render. */
function floatCopy(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) {
      arr[i * a.itemSize] = a.getX(i);
      if (a.itemSize > 1) arr[i * a.itemSize + 1] = a.getY(i);
      if (a.itemSize > 2) arr[i * a.itemSize + 2] = a.getZ(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  const count = g.getAttribute("position").count;
  g.setIndex(src.index ? Array.from(src.index.array as ArrayLike<number>) : Array.from({ length: count }, (_, i) => i));
  return g;
}

/**
 * All meshes under `root` baked into root space and merged per material (+ attribute set).
 * `pick` filters meshes; the result is normalised so the model stands on y = 0, centred in x/z, scaled to `height`
 * (or by `scale`).
 */
function mergeModel(root: THREE.Object3D, opts: { pick?: (m: THREE.Mesh) => boolean; height?: number; scale?: number; space?: THREE.Object3D }): Part[] {
  const space = opts.space ?? root; // baked into this object's frame (the GLB scene keeps the source up-axis fix)
  space.updateMatrixWorld(true);
  const inv = space.matrixWorld.clone().invert();
  const groups = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (opts.pick && !opts.pick(m))) return;
    const g = floatCopy(m.geometry);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const material = m.material as THREE.Material;
    const key = `${material.uuid}|${Object.keys(g.attributes).sort().join(",")}`;
    const entry = groups.get(key) ?? { material, geos: [] };
    entry.geos.push(g);
    groups.set(key, entry);
  });
  const parts = [...groups.values()].map(({ material, geos }) => ({ material, geometry: mergeGeometries(geos) ?? geos[0]! }));
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox!);
  }
  const size = box.getSize(new THREE.Vector3());
  const s = opts.height ? opts.height / size.y : (opts.scale ?? 1);
  const center = box.getCenter(new THREE.Vector3());
  const fix = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  for (const p of parts) {
    p.geometry.applyMatrix4(fix);
    p.geometry.computeBoundingSphere();
  }
  return parts;
}

/** One InstancedMesh per part, all sharing the same per-instance matrices. */
function Instanced({ parts, matrices, castShadow = false }: { parts: Part[]; matrices: THREE.Matrix4[]; castShadow?: boolean }) {
  return (
    <>
      {parts.map((p, i) => (
        <InstancedPart key={i} part={p} matrices={matrices} castShadow={castShadow} />
      ))}
    </>
  );
}
function InstancedPart({ part, matrices, castShadow }: { part: Part; matrices: THREE.Matrix4[]; castShadow: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);
  return <instancedMesh ref={ref} args={[part.geometry, part.material, matrices.length]} castShadow={castShadow} receiveShadow />;
}

const compose = (pos: [number, number, number], yaw: number, scale: [number, number, number] = [1, 1, 1]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(...scale));

/** Marks emissive (bulb) materials to twinkle: they pulse in three phases (animated by ChristmasDecor's frame loop). */
function markTwinkle(materials: THREE.Material[], base: number) {
  materials
    .filter((m): m is THREE.MeshStandardMaterial => (m as THREE.MeshStandardMaterial).emissive?.getHex() > 0)
    .forEach((m, i) => (m.userData.twinkle = { base, phase: (i % 3) * 2.1 }));
}

// ───────────────────────────── tree plaza ─────────────────────────────

// Not part of the tree: "material_0" is a flat backdrop card and "Material.010" a huge background dome from the
// Sketchfab scene (its bounds reach 5 units below the base: it made the tree float ~1.2 m up and shrank it).
const TREE_SCENERY = new Set(["material_0", "Material.010"]);

function TreePlaza({ lowPower }: { lowPower: boolean }) {
  const { scene } = useGLTF(URL.tree);
  const parts = useMemo(() => {
    const p = mergeModel(scene, { pick: (m) => !TREE_SCENERY.has((m.material as THREE.Material).name), height: XMAS_TREE.height });
    // The tree's fairy lights ("Light*" materials) glow in their own colour.
    const lights = p.map((q) => q.material).filter((m) => /^Light/.test(m.name)) as THREE.MeshStandardMaterial[];
    for (const m of lights) if (m.emissive.getHex() === 0) m.emissive.copy(m.color);
    markTwinkle(lights, 1.8);
    return p;
  }, [scene]);
  const target = useMemo(() => new THREE.Object3D(), []);
  const { x, z, height } = XMAS_TREE;
  return (
    <group>
      <group position={[x, 0, z]}>
        {parts.map((p, i) => (
          <mesh key={i} geometry={p.geometry} material={p.material} receiveShadow />
        ))}
        {/* Warm glow from the tree onto the floor and the presents. */}
        <pointLight position={[0, height * 0.55, 0]} color="#ffb85c" intensity={6} distance={9} decay={1.6} />
      </group>
      {!lowPower && (
        <>
          <primitive object={target} position={[x, height * 0.45, z]} />
          <spotLight position={[x - 1, 5.6, z + 5]} target={target} angle={0.6} penumbra={0.9} intensity={30} distance={14} decay={1.5} color="#fff0d6" />
        </>
      )}
    </group>
  );
}

function FloorProps() {
  const sleigh = useGLTF(URL.sleigh).scene;
  const santa = useGLTF(URL.santa).scene;
  const snowman = useGLTF(URL.snowman).scene;
  const sleighParts = useMemo(() => mergeModel(sleigh, { height: 1.55 }), [sleigh]);
  const santaParts = useMemo(() => mergeModel(santa, { height: 1.75 }), [santa]);
  const snowParts = useMemo(() => mergeModel(snowman, { height: 1.75 }), [snowman]);
  const at = (p: XmasProp) => compose([p.x, 0, p.z], p.yaw);
  const sleighM = useMemo(() => [at(XMAS_SLEIGH)], []);
  const santaM = useMemo(() => [at(XMAS_SANTA)], []);
  const snowM = useMemo(() => XMAS_SNOWMEN.map(at), []);
  return (
    <>
      <Instanced parts={sleighParts} matrices={sleighM} castShadow />
      <Instanced parts={santaParts} matrices={santaM} castShadow />
      <Instanced parts={snowParts} matrices={snowM} castShadow />
    </>
  );
}

// ───────────────────────────── wreaths, lights, wall decorations ─────────────────────────────

function Wreaths() {
  const { scene } = useGLTF(URL.wreath);
  const parts = useMemo(() => {
    const p = mergeModel(scene, { height: 0.8 });
    // Seen from behind too (it stands on the cap top): light the back instead of showing a dark ring.
    for (const { material } of p) material.side = THREE.DoubleSide;
    return p;
  }, [scene]);
  const matrices = useMemo(
    () =>
      XMAS_END_CAPS.faces.flatMap((f) =>
        // Wreath faces +Z in the model; turned to face out of the cap, standing on its top.
        XMAS_END_CAPS.z.map((z) => compose([f.x - f.dir * 0.15, XMAS_END_CAPS.top, z], (f.dir * Math.PI) / 2)),
      ).concat(XMAS_WALL_WREATHS.map(([x, y, z, yaw]) => compose([x, y, z], yaw, [1.4, 1.4, 1.4]))),
    [],
  );
  return <Instanced parts={parts} matrices={matrices} />;
}

/** Lights model: a 5.1 m sagging string along +Z, hooks at its top ends. */
const LIGHTS_LENGTH = 5.1;
const LIGHTS_SAG = 1.86;
function StringLights() {
  const { scene } = useGLTF(URL.lights);
  const parts = useMemo(() => {
    const p = mergeModel(scene, { scale: 1 });
    markTwinkle(p.map((q) => q.material), 4);
    return p;
  }, [scene]);
  const matrices = useMemo(
    () =>
      XMAS_LIGHT_SPANS.map(({ from, to, y }) => {
        const dx = to[0] - from[0];
        const dz = to[1] - from[1];
        const len = Math.hypot(dx, dz);
        const sag = 0.5;
        // x 0.7: the source string also curls sideways ~1.45 m; keep it within the aisle.
        return compose([(from[0] + to[0]) / 2, y - LIGHTS_SAG * sag, (from[1] + to[1]) / 2], Math.atan2(dx, dz), [0.7, sag, len / LIGHTS_LENGTH]);
      }),
    [],
  );
  return <Instanced parts={parts} matrices={matrices} />;
}

/**
 * The Sketchfab decoration set: 4 knitted stockings (node group6), two snowman baubles (group4) and a bunting garland
 * (sweep4). All face −X in the model, lengths along Z.
 */
function WallDecorations({ lowPower }: { lowPower: boolean }) {
  const { scene } = useGLTF(URL.decorations);
  const node = (name: string) => scene.getObjectByName(name);
  const stockings = useMemo(() => mergeModel(node("group6")!, { height: 0.55, space: scene }), [scene]); // eslint-disable-line react-hooks/exhaustive-deps
  const baubles = useMemo(() => mergeModel(node("group4")!, { height: 0.9, space: scene }), [scene]); // eslint-disable-line react-hooks/exhaustive-deps
  const bunting = useMemo(() => mergeModel(node("sweep4")!, { height: 0.75, space: scene }), [scene]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hung on the counter front, tops just under its lip.
  const stockingM = useMemo(() => [compose([-10.2, 0.32, 4.7], Math.PI)], []);
  // Giant snowman baubles: rotated so both heads show from the aisles.
  const baubleM = useMemo(() => XMAS_ORNAMENTS.map(([x, z, top], i) => compose([x, top - 0.9, z], i * 1.3)), []);
  // Bunting: along the hall walls (both sides) and the main store's north wall above the fixtures.
  const buntingM = useMemo(() => {
    const out: THREE.Matrix4[] = [];
    for (let x = 15.3; x < 24.5; x += 2.25) {
      out.push(compose([x, 3.4, -6.6], Math.PI / 2)); // south hall wall, facing +Z (into the hall)
      out.push(compose([x, 3.4, 8.0], -Math.PI / 2)); // north hall wall, facing −Z
    }
    for (let x = -12.0; x < -1.5; x += 2.25) out.push(compose([x, 3.4, 8.0], -Math.PI / 2));
    return out;
  }, []);
  return (
    <>
      <Instanced parts={stockings} matrices={stockingM} />
      {!lowPower && <Instanced parts={baubles} matrices={baubleM} />}
      <Instanced parts={bunting} matrices={buntingM} />
      {!lowPower && <OrnamentStrings />}
    </>
  );
}

/** Thin gold cords from the ceiling to each giant ornament. */
function OrnamentStrings() {
  const geo = useMemo(() => new THREE.CylinderGeometry(0.008, 0.008, 1, 4), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#d9b25a", metalness: 0.6, roughness: 0.4 }), []);
  const ceiling = 5.85;
  const matrices = useMemo(() => XMAS_ORNAMENTS.map(([x, z, top]) => compose([x, (ceiling + top) / 2, z], 0, [1, ceiling - top, 1])), []);
  return <Instanced parts={[{ geometry: geo, material: mat }]} matrices={matrices} />;
}

// ───────────────────────────── banner + snow ─────────────────────────────

function Banner() {
  const { x, y, z } = XMAS_BANNER;
  return (
    <group position={[x, y, z]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh position={[0, 0, -0.03]}>
        <boxGeometry args={[4.6, 1.05, 0.04]} />
        <meshStandardMaterial color="#8f0f1c" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, -0.05]}>
        <boxGeometry args={[4.72, 1.17, 0.02]} />
        <meshStandardMaterial color="#d9b25a" metalness={0.7} roughness={0.35} />
      </mesh>
      <Text position={[0, 0.14, 0]} fontSize={0.46} color="#fff6e0" anchorX="center" anchorY="middle" letterSpacing={0.04} fontWeight={800}>
        MERRY CHRISTMAS
      </Text>
      <Text position={[0, -0.3, 0]} fontSize={0.17} color="#f3cf7a" anchorX="center" anchorY="middle" letterSpacing={0.12}>
        HAPPY FAMILY · HAPPY ANIMALS
      </Text>
    </group>
  );
}

function snowSprite(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.75)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Gentle snowfall over the store and the hall (CPU-updated points; ~1.4k flakes). */
function Snowfall({ env, count }: { env: EnvLayout; count: number }) {
  const { min, max } = env.interior;
  const top = env.ceilingY - 0.2;
  const ref = useRef<THREE.Points>(null);
  const { geometry, drift } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const drift = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = min[0] + Math.random() * (max[0] - min[0]);
      pos[i * 3 + 1] = Math.random() * top;
      pos[i * 3 + 2] = min[2] + Math.random() * (max[2] - min[2]);
      drift[i * 2] = 0.25 + Math.random() * 0.35; // fall speed m/s
      drift[i * 2 + 1] = Math.random() * Math.PI * 2; // sway phase
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3((min[0] + max[0]) / 2, top / 2, (min[2] + max[2]) / 2), 40);
    return { geometry: g, drift };
  }, [count, min, max, top]);
  const material = useMemo(
    () => new THREE.PointsMaterial({ size: 0.05, map: snowSprite(), transparent: true, depthWrite: false, opacity: 0.9, sizeAttenuation: true }),
    [],
  );
  useFrame(({ clock }, dt) => {
    const step = Math.min(dt, 0.1);
    const t = clock.elapsedTime;
    const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const p = attr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const sway = Math.sin(t * 0.8 + drift[i * 2 + 1]!) * 0.12 * step;
      p[i * 3]! += sway;
      p[i * 3 + 2]! += sway * 0.6;
      p[i * 3 + 1]! -= drift[i * 2]! * step;
      if (p[i * 3 + 1]! < 0) p[i * 3 + 1] = top;
    }
    attr.needsUpdate = true;
  });
  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />;
}

// No module-level preload: StoreScene mounts the decoration after the core store is ready (progressive loading).

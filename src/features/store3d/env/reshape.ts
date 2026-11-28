/**
 * Load-time surgery on the imported supermarket (see ./extension): removes the old far wall, the removed fixtures
 * (FIXTURE_REMOVALS) and the side-wall faces that get shop doors (./shops). Runs once per loaded scene (the GLTF is
 * cached and shared by the homepage hero and /store, so the scene is marked as done).
 * Only meshes that have affected triangles are rebuilt; everything else keeps its original GPU buffers.
 */
import * as THREE from "three";
import { CUT_X, fixtureRemovalFor } from "./extension";
import { GONDOLA_SRC } from "./shop-interior";
import { wallFaceOf, type WallFace } from "./shops";

/** Plaster of the imported walls (the side-wall faces with shop doors are rebuilt by wing/RentalShops). */
export const WALL_MATERIAL = "Material.014";

/** Texture mapping of a removed wall face: u = cu·(x, y, 1), v = cv·(x, y, 1) in world metres. */
export interface WallUv {
  cu: [number, number, number];
  cv: [number, number, number];
}
/** scene.userData key: Record<"N-inner" | "N-outer" | "S-inner" | "S-outer", WallUv>. */
export const WALL_UV_KEY = "vswShopWallUv";
/** scene.userData key: extracted gondola parts for rental shop interiors (saved before main-aisle gondolas are removed). */
export const GONDOLA_PARTS_KEY = "vswGondolaParts";
export const wallFaceKey = (f: WallFace) => `${f.side}-${f.inner ? "inner" : "outer"}`;

export interface GondolaPartData {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const DONE = "vswExtended";

function extractGondolaParts(meshes: THREE.Mesh[]): GondolaPartData[] {
  const r = GONDOLA_SRC;
  const c = new THREE.Vector3((r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);
  const out: GondolaPartData[] = [];
  const p = new THREE.Vector3();
  for (const m of meshes) {
    if (Array.isArray(m.material)) continue;
    const g = m.geometry;
    const pos = g.getAttribute("position");
    if (!pos) continue;
    const idx = g.getIndex();
    const n = (idx ? idx.count : pos.count) / 3;
    const vi = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
    const names = Object.keys(g.attributes).filter((a) => a === "position" || a === "normal" || a === "uv");
    const data: Record<string, number[]> = Object.fromEntries(names.map((a) => [a, []]));
    for (let t = 0; t < n; t++) {
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) {
        p.fromBufferAttribute(pos, vi(t, k)).applyMatrix4(m.matrixWorld);
        cx += p.x / 3; cy += p.y / 3; cz += p.z / 3;
      }
      if (cx < r.minX || cx > r.maxX || cy < r.minY || cy > r.maxY || cz < r.minZ || cz > r.maxZ) continue;
      for (let k = 0; k < 3; k++) {
        const i = vi(t, k);
        for (const a of names) {
          const attr = g.getAttribute(a);
          if (a === "position") {
            p.fromBufferAttribute(attr, i).applyMatrix4(m.matrixWorld).sub(c);
            data[a]!.push(p.x, p.y, p.z);
          } else if (a === "normal") {
            p.fromBufferAttribute(attr, i).transformDirection(m.matrixWorld);
            data[a]!.push(p.x, p.y, p.z);
          } else for (let q = 0; q < attr.itemSize; q++) data[a]!.push(attr.getComponent(i, q));
        }
      }
    }
    if (!data.position!.length) continue;
    const geo = new THREE.BufferGeometry();
    for (const a of names) geo.setAttribute(a, new THREE.Float32BufferAttribute(data[a]!, g.getAttribute(a).itemSize));
    geo.computeBoundingSphere();
    out.push({ geometry: geo, material: m.material });
  }
  return out;
}

export function reshapeSupermarket(scene: THREE.Object3D): void {
  if (scene.userData[DONE]) return;
  scene.userData[DONE] = true;
  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  scene.userData[GONDOLA_PARTS_KEY] = extractGondolaParts(meshes);
  scene.userData[WALL_UV_KEY] = {};
  for (const m of meshes) {
    if (!Array.isArray(m.material) && CEILING_RIG_MATERIALS.includes(m.material.name)) {
      // Owner's request (2026-11-26): no hanging truss rig; flush LED battens are drawn instead (wing/NewWing CeilingLights).
      m.removeFromParent();
      m.geometry.dispose();
      continue;
    }
    reshapeMesh(m, scene.userData[WALL_UV_KEY] as Record<string, WallUv>);
  }
}

/** The imported store's hanging steel trusses (Material.013) and the emissive light strips they carry ("material"). */
const CEILING_RIG_MATERIALS = ["Material.013", "material"];
/** The rig's lamp-carrier channels: full-length bars (y 4.43 → 4.56) in the shared "material_0" mesh. They hung in front
 *  of the shop fascia signs once the trusses were gone (owner's request 2026-11-26), so their triangles are dropped. */
const RIG_BAR = { material: "material_0", minY: 4.4, maxY: 4.6 } as const;

/** Affine (x, y) → uv of one triangle; null when degenerate in x/y. */
function solveUv(p: THREE.Vector3[], uv: [number, number][]): WallUv | null {
  const m = new THREE.Matrix3().set(p[0]!.x, p[0]!.y, 1, p[1]!.x, p[1]!.y, 1, p[2]!.x, p[2]!.y, 1);
  if (Math.abs(m.determinant()) < 1e-9) return null;
  const inv = m.clone().invert();
  const solve = (c: 0 | 1) => new THREE.Vector3(uv[0]![c], uv[1]![c], uv[2]![c]).applyMatrix3(inv);
  const a = solve(0);
  const b = solve(1);
  return { cu: [a.x, a.y, a.z], cv: [b.x, b.y, b.z] };
}

function reshapeMesh(mesh: THREE.Mesh, wallUv: Record<string, WallUv>): void {
  const isWall = !Array.isArray(mesh.material) && mesh.material.name === WALL_MATERIAL;
  const hasRigBars = !Array.isArray(mesh.material) && mesh.material.name === RIG_BAR.material;
  const uvAttr = mesh.geometry.getAttribute("uv");
  const src = mesh.geometry;
  const pos = src.getAttribute("position");
  if (!pos) return;
  const index = src.getIndex();
  const triCount = (index ? index.count : pos.count) / 3;
  const vi = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  // Geometry is merged per material and baked to world space by the build script, but be safe about node transforms.
  const toWorld = mesh.matrixWorld;
  const identity = toWorld.equals(new THREE.Matrix4());
  const v = new THREE.Vector3();
  const world = (i: number) => (identity ? v.fromBufferAttribute(pos, i) : v.fromBufferAttribute(pos, i).applyMatrix4(toWorld));

  const keep: number[] = [];
  let changed = false;
  for (let t = 0; t < triCount; t++) {
    let minX = Infinity, minY = Infinity, maxY = -Infinity;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) {
      const p = world(vi(t, k));
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      cx += p.x / 3; cy += p.y / 3; cz += p.z / 3;
    }
    if (minX >= CUT_X) { changed = true; continue; } // the old far wall
    if (hasRigBars && minY >= RIG_BAR.minY && maxY <= RIG_BAR.maxY) { changed = true; continue; } // orphaned rig bar
    if (isWall) {
      const pts = [0, 1, 2].map((k) => world(vi(t, k)).clone());
      const face = wallFaceOf(pts.map((q) => [q.x, q.y, q.z] as [number, number, number]));
      if (face) {
        // A side-wall face that gets shop doors: rebuilt with holes by wing/RentalShops, using the same mapping.
        const key = wallFaceKey(face);
        if (!wallUv[key] && uvAttr) {
          const solved = solveUv(pts, [0, 1, 2].map((k) => [uvAttr.getX(vi(t, k)), uvAttr.getY(vi(t, k))] as [number, number]));
          if (solved) wallUv[key] = solved;
        }
        changed = true;
        continue;
      }
    }
    if (fixtureRemovalFor(cx, cy, cz)) { changed = true; continue; } // removed fixture (freezers, fridges)
    keep.push(t);
  }
  if (!changed) return;

  // Rebuild with the kept triangles only (their vertices copied unchanged).
  const names = Object.keys(src.attributes);
  const out: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, []]));
  const remap = new Map<number, number>();
  const indices: number[] = [];
  let next = 0;
  const copyVertex = (i: number) => {
    for (const n of names) {
      const a = src.getAttribute(n);
      for (let c = 0; c < a.itemSize; c++) out[n]!.push(a.getComponent(i, c));
    }
    return next++;
  };
  for (const t of keep) {
    for (let k = 0; k < 3; k++) {
      const i = vi(t, k);
      let j = remap.get(i);
      if (j === undefined) remap.set(i, (j = copyVertex(i)));
      indices.push(j);
    }
  }

  const geo = new THREE.BufferGeometry();
  for (const n of names) {
    const a = src.getAttribute(n);
    geo.setAttribute(n, new THREE.Float32BufferAttribute(out[n]!, a.itemSize));
  }
  geo.setIndex(next > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  mesh.geometry = geo;
  src.dispose();
}

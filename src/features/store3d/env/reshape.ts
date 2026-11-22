/**
 * Load-time surgery on the imported supermarket (see ./extension): removes the old far wall and moves the two
 * fridge banks that stood against it onto the side walls of the new hall. Runs once per loaded scene (the GLTF is
 * cached and shared by the homepage hero and /store, so the scene is marked as done).
 * Only meshes that have affected triangles are rebuilt; everything else keeps its original GPU buffers.
 */
import * as THREE from "three";
import { CUT_X, fridgeMoveFor, moveXZ, type FridgeMove } from "./extension";

const DONE = "vswExtended";

export function reshapeSupermarket(scene: THREE.Object3D): void {
  if (scene.userData[DONE]) return;
  scene.userData[DONE] = true;
  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const m of meshes) reshapeMesh(m);
}

function reshapeMesh(mesh: THREE.Mesh): void {
  const src = mesh.geometry;
  const pos = src.getAttribute("position");
  if (!pos) return;
  const index = src.getIndex();
  const triCount = (index ? index.count : pos.count) / 3;
  const vi = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  // Geometry is merged per material and baked to world space by the build script, but be safe about node transforms.
  const toWorld = mesh.matrixWorld;
  const identity = toWorld.equals(new THREE.Matrix4());
  const toLocal = toWorld.clone().invert();
  const v = new THREE.Vector3();
  const world = (i: number) => (identity ? v.fromBufferAttribute(pos, i) : v.fromBufferAttribute(pos, i).applyMatrix4(toWorld));

  const keep: number[] = [];
  const moved: { tri: number; f: FridgeMove }[] = [];
  let changed = false;
  for (let t = 0; t < triCount; t++) {
    let minX = Infinity;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) {
      const p = world(vi(t, k));
      minX = Math.min(minX, p.x);
      cx += p.x / 3; cy += p.y / 3; cz += p.z / 3;
    }
    if (minX >= CUT_X) { changed = true; continue; } // the old far wall
    const f = fridgeMoveFor(cx, cy, cz);
    if (f) { moved.push({ tri: t, f }); changed = true; continue; }
    keep.push(t);
  }
  if (!changed) return;

  // Rebuild: kept triangles reuse their vertices; moved triangles get transformed copies.
  const names = Object.keys(src.attributes);
  const out: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, []]));
  const remap = new Map<number, number>();
  const indices: number[] = [];
  let next = 0;
  const copyVertex = (i: number, f: FridgeMove | null) => {
    for (const n of names) {
      const a = src.getAttribute(n);
      const dst = out[n]!;
      if (n === "position" || n === "normal") {
        const w = n === "position" ? world(i).clone() : new THREE.Vector3().fromBufferAttribute(a, i).transformDirection(toWorld);
        if (f) {
          if (n === "position") {
            const [x, z] = moveXZ(f, w.x, w.z);
            w.set(x, w.y, z);
          } else {
            w.applyAxisAngle(THREE.Object3D.DEFAULT_UP, f.rotationY);
          }
        }
        // Back to mesh-local space (identity for this model).
        if (!identity) {
          if (n === "position") w.applyMatrix4(toLocal);
          else w.transformDirection(toLocal);
        }
        dst.push(w.x, w.y, w.z);
      } else if (n === "tangent" && f) {
        const tg = new THREE.Vector3().fromBufferAttribute(a, i).applyAxisAngle(THREE.Object3D.DEFAULT_UP, f.rotationY);
        dst.push(tg.x, tg.y, tg.z, a.getW(i));
      } else {
        for (let c = 0; c < a.itemSize; c++) dst.push(a.getComponent(i, c));
      }
    }
    return next++;
  };
  for (const t of keep) {
    for (let k = 0; k < 3; k++) {
      const i = vi(t, k);
      let j = remap.get(i);
      if (j === undefined) remap.set(i, (j = copyVertex(i, null)));
      indices.push(j);
    }
  }
  const movedRemap = new Map<number, number>();
  for (const { tri, f } of moved) {
    for (let k = 0; k < 3; k++) {
      const i = vi(tri, k);
      let j = movedRemap.get(i);
      if (j === undefined) movedRemap.set(i, (j = copyVertex(i, f)));
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

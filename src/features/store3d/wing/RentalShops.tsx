"use client";

/**
 * Rental shop units in the main store's side walls (data: ../env/shops.ts). The imported plaster faces of those walls
 * are removed at load time (../env/reshape.ts) and rebuilt here with door holes, using the very same material and
 * texture mapping, so the wall looks untouched. Each unit: lacquered portal frame + canopy in the tenant's door colour
 * with animated neon lighting (ShopDoorLights, style set by the tenant / an admin), glass storefront (double
 * door + transom), a lit, empty shop room behind it ("YOUR BRAND HERE" feature wall, shelving, counter), crossed
 * chains with a padlock, and a "FOR RENT" fascia sign + hanging plaque. Closed: the wall colliders are unchanged.
 */
import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoundedBox, Text, useGLTF } from "@react-three/drei";
import { ASSETS } from "../assets/registry";
import { reshapeSupermarket, WALL_MATERIAL, WALL_UV_KEY, wallFaceKey, type WallUv } from "../env/reshape";
import { doorHoles, intoStore, SHOP_DOOR, SHOP_ROOM, SHOP_UNITS, WALL_FACES, type ShopUnit, type WallFace } from "../env/shops";
import { chainSegments, type ChainSpan } from "./chains";
import { brandPanel, counterLayout, GONDOLA_SRC, gondolaCenters, podiumLayout, roomDims, shelvingRun, toWorld, unitFrame, type UnitFrame, type V3 } from "../env/shop-interior";
import { Padlock } from "./NewWing";
import { useInteractable } from "../interactables";
import type { InteractionTarget } from "../ui-store";
import type { PublicShop, PublicStorefront } from "@/features/rentals/format";
import { useImageTexture } from "./image-texture";
import { TenantShelves } from "./TenantProducts";
import { ShopDoorLights } from "./ShopDoorLights";
import { DEFAULT_DOOR_STYLE } from "@/lib/rentals/door-style";

const STEEL = "#23272b";
const AMBER = "#f7c416";
const INK = "#0d1311";
const W = SHOP_DOOR.width;
const H = SHOP_DOOR.height;
const CHAIN_SEGMENT = 0.5;

// ───────────────────────────── rebuilt wall faces ─────────────────────────────

function wallGeometry(face: WallFace, uv: WallUv | undefined): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(face.x0, face.y0);
  shape.lineTo(face.x1, face.y0);
  shape.lineTo(face.x1, face.y1);
  shape.lineTo(face.x0, face.y1);
  shape.closePath();
  for (const [x0, x1, y0, y1] of doorHoles(face.side)) {
    const hole = new THREE.Path();
    // A hole touching the shape's bottom edge breaks the triangulation: start it a hair above.
    const b = Math.max(y0, face.y0 + 0.001);
    hole.moveTo(x0, b);
    hole.lineTo(x0, y1);
    hole.lineTo(x1, y1);
    hole.lineTo(x1, b);
    hole.closePath();
    shape.holes.push(hole);
  }
  const g = new THREE.ShapeGeometry(shape);
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  const uvs = g.getAttribute("uv");
  // Faces the store (inner) or the outside; double-sided material, but keep winding = normal for correct lighting.
  const nz = face.inner ? intoStore(face.side) : -intoStore(face.side);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, face.z);
    nrm.setXYZ(i, 0, 0, nz);
    if (uv) uvs.setXY(i, uv.cu[0] * x + uv.cu[1] * y + uv.cu[2], uv.cv[0] * x + uv.cv[1] * y + uv.cv[2]);
  }
  if (nz < 0 && g.index) {
    const idx = g.index.array as unknown as number[];
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2]!, idx[i + 1]!];
    g.index.needsUpdate = true;
  }
  g.computeBoundingSphere();
  return g;
}

function RebuiltWalls() {
  const { scene, materials } = useGLTF(ASSETS.supermarket.url);
  useMemo(() => reshapeSupermarket(scene), [scene]); // idempotent; makes sure the faces were cut + uv recorded
  const material = materials[WALL_MATERIAL]!;
  const geos = useMemo(() => {
    const uv = scene.userData[WALL_UV_KEY] as Record<string, WallUv> | undefined;
    return WALL_FACES.map((f) => wallGeometry(f, uv?.[wallFaceKey(f)]));
  }, [scene]);
  useLayoutEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  return (
    <group>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} material={material} receiveShadow />
      ))}
    </group>
  );
}

// ───────────────────────────── one unit (local frame) ─────────────────────────────
// Local frame: origin at the door's centre on the wall's inner face, +z into the store, +x to the right when facing
// the shop from the store, y up. The wall is `t` thick (local z 0 → −t); the room is behind it.

function useShopMaterials() {
  const m = useMemo(
    () => ({
      steel: new THREE.MeshStandardMaterial({ color: STEEL, metalness: 0.75, roughness: 0.38 }),
      brushed: new THREE.MeshStandardMaterial({ color: "#c7ccd1", metalness: 1, roughness: 0.22 }),
      glass: new THREE.MeshStandardMaterial({ color: "#a8c3cf", metalness: 0.3, roughness: 0.04, transparent: true, opacity: 0.18, depthWrite: false, envMapIntensity: 1.6 }),
      roomWall: new THREE.MeshStandardMaterial({ color: "#f1eee8", roughness: 0.85, emissive: "#fff4e2", emissiveIntensity: 0.28, side: THREE.BackSide }),
      floor: new THREE.MeshStandardMaterial({ color: "#c9a77c", roughness: 0.45, emissive: "#3a2a16", emissiveIntensity: 0.25 }),
      ceiling: new THREE.MeshStandardMaterial({ color: "#fbfaf7", roughness: 0.9, emissive: "#ffffff", emissiveIntensity: 0.35 }),
      led: new THREE.MeshBasicMaterial({ color: "#fff6e0", toneMapped: false }),
      shelf: new THREE.MeshStandardMaterial({ color: "#f7f6f2", roughness: 0.5, emissive: "#ffffff", emissiveIntensity: 0.12 }),
      feature: new THREE.MeshStandardMaterial({ color: INK, roughness: 0.6 }),
      threshold: new THREE.MeshStandardMaterial({ color: "#2e3134", roughness: 0.35, metalness: 0.2 }),
      sign: new THREE.MeshStandardMaterial({ color: INK, roughness: 0.45, metalness: 0.2 }),
      amber: new THREE.MeshStandardMaterial({ color: AMBER, roughness: 0.4, metalness: 0.3 }),
      plaque: new THREE.MeshStandardMaterial({ color: "#c8102e", roughness: 0.45 }),
      skin: new THREE.MeshStandardMaterial({ color: "#8f8b84", roughness: 0.95 }),
      hidden: new THREE.MeshBasicMaterial({ visible: false }),
      counterTop: new THREE.MeshStandardMaterial({ color: "#1c1f22", roughness: 0.3, metalness: 0.3 }),
      halo: new THREE.MeshBasicMaterial({ color: "#f7c416", transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false }),
      skirting: new THREE.MeshStandardMaterial({ color: "#2b2f33", roughness: 0.6 }),
      wood: new THREE.MeshStandardMaterial({ color: "#a07a52", roughness: 0.62, emissive: "#2e1d0d", emissiveIntensity: 0.3 }),
      border: new THREE.MeshStandardMaterial({ color: "#4a433b", roughness: 0.4, emissive: "#14100c", emissiveIntensity: 0.2 }),
    }),
    [],
  );
  useLayoutEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m]);
  return m;
}
type ShopMats = ReturnType<typeof useShopMaterials>;

/** Lacquered door finish in the tenant's colour (clear-coated metal, so it catches the store's reflections). */
function useFrameMaterial(color: string) {
  const m = useMemo(() => new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.08 }), [color]);
  useLayoutEffect(() => () => m.dispose(), [m]);
  return m;
}

const FRAME_W = 0.2; // portal frame width on the store side

function Portal({ t, mats, frame }: { t: number; mats: ShopMats; frame: THREE.Material }) {
  const fw = FRAME_W;
  const fd = 0.07; // proud of the wall
  return (
    <group>
      {/* frame on the store side, with a bevelled inner lip */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <RoundedBox args={[fw, H + fw, fd]} radius={0.02} smoothness={2} position={[s * (W / 2 + fw / 2), (H + fw) / 2, fd / 2]} material={frame} castShadow />
          <mesh position={[s * (W / 2 + 0.015), H / 2, fd + 0.004]} material={mats.brushed}>
            <boxGeometry args={[0.03, H, 0.008]} />
          </mesh>
        </group>
      ))}
      <RoundedBox args={[W + fw * 2, fw, fd]} radius={0.02} smoothness={2} position={[0, H + fw / 2, fd / 2]} material={frame} castShadow />
      <mesh position={[0, H + 0.015, fd + 0.004]} material={mats.brushed}>
        <boxGeometry args={[W + 0.03, 0.03, 0.008]} />
      </mesh>
      {/* slim cantilevered canopy over the entrance (LED line under its front edge: ShopDoorLights) */}
      <RoundedBox args={[W + 0.8, 0.07, 0.5]} radius={0.02} smoothness={2} position={[0, H + fw + 0.07, 0.25]} material={frame} castShadow />
      {/* reveals through the wall */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (W / 2 - 0.01), H / 2, -t / 2]} material={frame}>
          <boxGeometry args={[0.02, H, t + 0.02]} />
        </mesh>
      ))}
      <mesh position={[0, H - 0.01, -t / 2]} material={frame}>
        <boxGeometry args={[W, 0.02, t + 0.02]} />
      </mesh>
      <mesh position={[0, 0.006, -t / 2 + 0.03]} material={mats.threshold} receiveShadow>
        <boxGeometry args={[W, 0.012, t + 0.06]} />
      </mesh>
      {/* brushed aluminium cladding pilasters either side of the frame with fluted grooves, on a plinth in the door
          colour (their LED lines: ShopDoorLights) */}
      {[-1, 1].map((s) => (
        <group key={`c${s}`} position={[s * (W / 2 + fw + 0.2), 0, 0]}>
          <mesh position={[0, (H + fw) / 2, 0.025]} material={mats.brushed}>
            <boxGeometry args={[0.4, H + fw, 0.05]} />
          </mesh>
          {[-0.08, 0, 0.08].map((x) => (
            <mesh key={x} position={[x + s * 0.03, (H + fw) / 2 + 0.12, 0.051]} material={mats.steel}>
              <boxGeometry args={[0.012, H + fw - 0.28, 0.004]} />
            </mesh>
          ))}
          <mesh position={[0, 0.12, 0.035]} material={frame}>
            <boxGeometry args={[0.42, 0.24, 0.07]} />
          </mesh>
        </group>
      ))}
      {/* inside the opening: LED strip along the head reveal */}
      <mesh position={[0, H - 0.03, -t / 2]} material={mats.led}>
        <boxGeometry args={[W - 0.3, 0.012, 0.05]} />
      </mesh>
    </group>
  );
}

/**
 * Aluminium storefront set just inside the opening: fixed glass side lites, a central double glass door with long
 * pull bars, and a full-width transom above.
 */
function Storefront({ mats, open, frame }: { mats: ShopMats; open: boolean; frame: THREE.Material }) {
  const z = -0.14;
  const p = 0.06; // profile
  const doorH = 3.0;
  const dw = Math.min(2.2, W - 2 * p); // double door opening
  const leaf = dw / 2;
  const side = (W - dw) / 2; // each fixed side lite incl. its profiles
  const post = (x: number, h = H) => (
    <mesh key={`p${x}`} position={[x, h / 2, 0]} material={frame}>
      <boxGeometry args={[p, h, 0.09]} />
    </mesh>
  );
  return (
    <group position={[0, 0, z]}>
      {post(-W / 2 + p / 2)}
      {post(W / 2 - p / 2)}
      {side > 0.2 && post(-dw / 2 - p / 2)}
      {side > 0.2 && post(dw / 2 + p / 2)}
      {/* transom bar, head and sill */}
      <mesh position={[0, doorH + p / 2, 0]} material={frame}>
        <boxGeometry args={[W, p, 0.09]} />
      </mesh>
      <mesh position={[0, H - p / 2, 0]} material={frame}>
        <boxGeometry args={[W, p, 0.09]} />
      </mesh>
      {/* transom glass */}
      <mesh position={[0, (doorH + H) / 2 + p / 4, 0]} material={mats.glass}>
        <planeGeometry args={[W - 2 * p, H - doorH - 1.5 * p]} />
      </mesh>
      {/* fixed side lites with a kick plate */}
      {side > 0.2 &&
        [-1, 1].map((s) => {
          const cx = s * (dw / 2 + side / 2);
          return (
            <group key={s} position={[cx, 0, 0]}>
              <mesh position={[0, 0.1, 0]} material={frame}>
                <boxGeometry args={[side - p, 0.2, 0.06]} />
              </mesh>
              <mesh position={[0, (doorH + 0.2) / 2, 0]} material={mats.glass}>
                <planeGeometry args={[side - 2 * p, doorH - 0.2]} />
              </mesh>
            </group>
          );
        })}
      {/* door leaves (an open shop has its double door swung back out of sight) */}
      {!open && [-1, 1].map((s) => {
        const cx = s * (leaf / 2);
        return (
          <group key={s} position={[cx, 0, 0.012]}>
            {[-1, 1].map((e) => (
              <mesh key={e} position={[e * (leaf / 2 - 0.035), doorH / 2, 0]} material={frame}>
                <boxGeometry args={[0.07, doorH, 0.05]} />
              </mesh>
            ))}
            <mesh position={[0, 0.08, 0]} material={frame}>
              <boxGeometry args={[leaf, 0.16, 0.05]} />
            </mesh>
            <mesh position={[0, doorH - 0.04, 0]} material={frame}>
              <boxGeometry args={[leaf, 0.08, 0.05]} />
            </mesh>
            <mesh position={[0, doorH / 2 + 0.04, 0]} material={mats.glass}>
              <planeGeometry args={[leaf - 0.14, doorH - 0.24]} />
            </mesh>
            {/* long pull bar next to the meeting stiles */}
            <group position={[-s * (leaf / 2 - 0.15), 1.2, 0.07]}>
              <mesh material={mats.brushed} castShadow>
                <cylinderGeometry args={[0.017, 0.017, 1.3, 14]} />
              </mesh>
              {[-0.55, 0.55].map((y) => (
                <mesh key={y} position={[0, y, -0.035]} rotation-x={Math.PI / 2} material={mats.brushed}>
                  <cylinderGeometry args={[0.011, 0.011, 0.07, 10]} />
                </mesh>
              ))}
            </group>
          </group>
        );
      })}
    </group>
  );
}

/** Brand wall panel at the back of a room (local): width, bottom, top. */

/**
 * Lit shop room behind the wall (local z −t → −t − depth): the shell, floor, ceiling, the brand name on the back wall
 * and the display podiums. Everything box-shaped (shelving, lights, trims) is instanced across all rooms by
 * ShopFittings; the gondolas by ShopGondolas.
 */
function Room({ f, label, mats, brand, store }: { f: UnitFrame; label: string; mats: ShopMats; brand: string | null; store: PublicStorefront | null }) {
  const { cx, w, zf, zb, h } = roomDims(f);
  const d = zf - zb;
  const cz = (zf + zb) / 2;
  const { pw, y0, y1 } = brandPanel(w);
  const title = brand ?? "YOUR BRAND HERE";
  const pod = podiumLayout(f);
  return (
    <group>
      <mesh position={[cx, h / 2, cz]} material={mats.roomWall}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      {/* solid outside skin: seen from outside the store the room reads as a neighbouring building */}
      {/* BoxGeometry faces: +x, −x, +y, −y, +z (front = the wall side: hidden, or it would cover the door), −z */}
      <mesh position={[cx, h / 2 + 0.04, cz - 0.04]} material={[mats.skin, mats.skin, mats.skin, mats.skin, mats.hidden, mats.skin]}>
        <boxGeometry args={[w + 0.08, h + 0.08, d + 0.08]} />
      </mesh>
      {/* where the store has windows instead of a wall, they become the shop's display windows: a lit sill + LED
          line at the room's front, and the room box's own front face closes it from the inside */}
      {f.front && (
        <group position={[(f.front[0] + f.front[1]) / 2, 0, zf - 0.45]}>
          <mesh position={[0, 0.3, 0]} material={mats.shelf}>
            <boxGeometry args={[f.front[1] - f.front[0] - 0.2, 0.6, 0.8]} />
          </mesh>
          <mesh position={[0, 0.61, 0]} material={mats.amber}>
            <boxGeometry args={[f.front[1] - f.front[0] - 0.2, 0.02, 0.82]} />
          </mesh>
        </group>
      )}
      <mesh position={[cx, 0.002, cz]} rotation-x={-Math.PI / 2} material={mats.floor} receiveShadow>
        <planeGeometry args={[w, d]} />
      </mesh>
      <mesh position={[cx, h - 0.002, cz]} rotation-x={Math.PI / 2} material={mats.ceiling}>
        <planeGeometry args={[w, d]} />
      </mesh>
      {/* brand name on the back feature wall (panel, trims and light lines: ShopFittings) */}
      <Text position={[cx, (y0 + y1) / 2 + 0.35, zb + 0.08]} fontSize={Math.min(0.95, (0.95 * 14) / Math.max(14, title.length))} maxWidth={pw - 0.6} letterSpacing={0.06} color={AMBER} anchorX="center" anchorY="middle" fontWeight={800}>
        {title}
      </Text>
      <Text position={[cx, y0 + 0.75, zb + 0.08]} fontSize={0.22} letterSpacing={0.32} color="#f3ede0" anchorX="center" anchorY="middle">
        {store?.tagline ? store.tagline.toUpperCase() : brand ? label : `${label} · ${SHOP_ROOM.width} × ${SHOP_ROOM.depth} M · AVAILABLE FOR RENT`}
      </Text>
      {store?.logoUrl && <BrandLogo url={store.logoUrl} position={[cx, (y0 + y1) / 2 + 1.25, zb + 0.08]} />}
      {/* podium trio by the window: white drums with amber caps */}
      {pod.show &&
        pod.items.map(({ x, z, r, h: ph }, i) => (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, ph / 2, 0]} material={mats.shelf}>
              <cylinderGeometry args={[r, r, ph, 28]} />
            </mesh>
            <mesh position={[0, ph + 0.012, 0]} material={mats.amber}>
              <cylinderGeometry args={[r + 0.02, r + 0.02, 0.024, 28]} />
            </mesh>
          </group>
        ))}
    </group>
  );
}

/** The tenant's logo on the brand wall (square, on a white tile). */
function BrandLogo({ url, position }: { url: string; position: V3 }) {
  const tex = useImageTexture(url);
  if (!tex) return null;
  return (
    <group position={position}>
      <mesh position={[0, 0, -0.005]}>
        <planeGeometry args={[0.86, 0.86]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      <mesh>
        <planeGeometry args={[0.8, 0.8]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

type FittingKind = "led" | "steel" | "shelf" | "wood" | "ink" | "amber" | "border";
/** An axis-aligned box in a unit's local frame: centre + size. */
interface LocalBox {
  p: V3;
  s: V3;
}

/**
 * Every box-shaped fitting of one room (local frame), by material: ceiling LED grid, track lights, wall shelving runs
 * on both side walls, the brand feature wall with slats and light lines, the checkout counter, floor border, skirting
 * and the entrance mat. Pure, so all rooms can share one InstancedMesh per material.
 */
function roomFittings(f: UnitFrame): Record<FittingKind, LocalBox[]> {
  const out: Record<FittingKind, LocalBox[]> = { led: [], steel: [], shelf: [], wood: [], ink: [], amber: [], border: [] };
  const add = (k: FittingKind, x: number, y: number, z: number, sx: number, sy: number, sz: number) => out[k].push({ p: [x, y, z], s: [sx, sy, sz] });
  const { xl, xr, cx, w, zf, zb, h } = roomDims(f);
  const d = zf - zb;
  const cz = (zf + zb) / 2;

  // Ceiling: recessed LED panel grid, a front bulkhead (hides the ceiling edge through the transom), track lights.
  const cols = [-6, -3, 0, 3, 6].filter((o) => Math.abs(o) < w / 2 - 1.5);
  for (let z = zf - 2.4; z > zb + 1.5; z -= 2.8) for (const o of cols) add("led", cx + o, h - 0.012, z, 1.2, 0.02, 0.6);
  add("ink", cx, h - 0.3, zf - 0.35, w, 0.6, 0.7);
  for (const s of [-1, 1]) {
    const x = s < 0 ? xl + 1.4 : xr - 1.4;
    add("steel", x, h - 0.03, (zf - 4 + zb + 2) / 2, 0.06, 0.04, d - 6);
    for (let z = zf - 4.6; z > zb + 2.4; z -= 1.8) {
      add("steel", x, h - 0.17, z, 0.11, 0.24, 0.11);
      add("led", x, h - 0.296, z, 0.08, 0.012, 0.08);
    }
  }

  // Wall shelving on both side walls: oak back panel, uprights, five shelves, lit header with an amber line.
  const { z0, z1 } = shelvingRun(f);
  const len = z0 - z1;
  const mid = (z0 + z1) / 2;
  for (const s of [-1, 1]) {
    const wx = s < 0 ? xl : xr;
    const inw = -s; // into the room
    add("wood", wx + inw * 0.03, 1.45, mid, 0.04, 2.7, len);
    add("steel", wx + inw * 0.24, 0.08, mid, 0.42, 0.16, len);
    const n = Math.round(len / 1.25);
    for (let i = 0; i <= n; i++) add("steel", wx + inw * 0.25, 1.4, z0 - (i * len) / n, 0.42, 2.8, 0.05);
    for (const y of [0.3, 0.85, 1.4, 1.95, 2.5]) add("shelf", wx + inw * 0.26, y, mid, 0.42, 0.03, len);
    add("led", wx + inw * 0.46, 2.47, mid, 0.012, 0.012, len);
    add("ink", wx + inw * 0.26, 2.95, mid, 0.52, 0.3, len + 0.1);
    add("amber", wx + inw * 0.525, 2.95, mid, 0.01, 0.05, len + 0.1);
  }

  // Back feature wall: black panel in an amber frame, light lines, oak slats either side, low display plinth.
  const { pw, y0, y1 } = brandPanel(w);
  const py = (y0 + y1) / 2;
  const ph = y1 - y0;
  add("ink", cx, py, zb + 0.04, pw, ph, 0.06);
  add("amber", cx, y1 + 0.03, zb + 0.07, pw + 0.12, 0.06, 0.04);
  add("amber", cx, y0 - 0.03, zb + 0.07, pw + 0.12, 0.06, 0.04);
  for (const s of [-1, 1]) {
    add("amber", cx + s * (pw / 2 + 0.03), py, zb + 0.07, 0.06, ph + 0.12, 0.04);
    add("led", cx + s * (pw / 2 + 0.7), py, zb + 0.035, 0.08, ph, 0.03);
    const inner = cx + s * (pw / 2 + 1.1);
    const outer = s < 0 ? xl + 0.5 : xr - 0.5;
    for (let x = inner; s * (outer - x) > 0; x += s * 0.2) add("wood", x, 2.3, zb + 0.045, 0.08, 3.9, 0.05);
  }
  add("led", cx, y1 + 0.32, zb + 0.04, pw + 1.6, 0.03, 0.04);
  add("shelf", cx, 0.25, zb + 0.55, pw, 0.5, 0.9);
  add("amber", cx, 0.04, zb + 1.002, pw, 0.08, 0.004);

  // Checkout counter at the front, on the wider side of the door: white body, black top, amber band, LED kick, POS.
  const { cs, ccx, ccz } = counterLayout(f);
  add("shelf", ccx, 0.5, ccz, 3.0, 1.0, 0.8);
  add("ink", ccx, 1.02, ccz, 3.1, 0.04, 0.9);
  add("amber", ccx, 0.72, ccz + 0.402, 3.0, 0.08, 0.004);
  add("led", ccx, 0.05, ccz + 0.402, 2.9, 0.02, 0.004);
  add("ink", ccx - cs * 0.8, 1.26, ccz - 0.15, 0.42, 0.3, 0.03);
  add("steel", ccx - cs * 0.8, 1.08, ccz - 0.12, 0.06, 0.1, 0.06);
  // Back cabinet against the side wall behind the counter.
  add("wood", cs < 0 ? xl + 0.3 : xr - 0.3, 1.1, ccz + 0.2, 0.6, 2.2, 2.6);

  // Floor: dark border band along the walls, skirting, entrance mat inside the door.
  add("border", xl + 0.15, 0.003, cz, 0.3, 0.006, d);
  add("border", xr - 0.15, 0.003, cz, 0.3, 0.006, d);
  add("border", cx, 0.003, zb + 0.15, w, 0.006, 0.3);
  add("steel", xl + 0.01, 0.06, cz, 0.02, 0.12, d);
  add("steel", xr - 0.01, 0.06, cz, 0.02, 0.12, d);
  add("steel", cx, 0.06, zb + 0.01, w, 0.12, 0.02);
  add("ink", 0, 0.005, zf - 1.1, SHOP_DOOR.width - 0.6, 0.01, 1.8);
  add("amber", 0, 0.006, zf - 2.0, SHOP_DOOR.width - 0.6, 0.012, 0.04);
  return out;
}

/** World matrix of a unit's local frame. */
function frameMatrix(f: UnitFrame): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(...f.position), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.rotationY), new THREE.Vector3(1, 1, 1));
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** All rooms' box fittings: one InstancedMesh (unit cube, scaled per instance) per material. */
function ShopFittings({ mats }: { mats: ShopMats }) {
  const byKind = useMemo(() => {
    const acc: Record<FittingKind, THREE.Matrix4[]> = { led: [], steel: [], shelf: [], wood: [], ink: [], amber: [], border: [] };
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (const u of SHOP_UNITS) {
      const f = unitFrame(u);
      const m = frameMatrix(f);
      const boxes = roomFittings(f);
      for (const k of Object.keys(boxes) as FittingKind[]) for (const b of boxes[k]) acc[k].push(m.clone().multiply(new THREE.Matrix4().compose(p.set(...b.p), q, s.set(...b.s))));
    }
    return acc;
  }, []);
  const material: Record<FittingKind, THREE.Material> = { led: mats.led, steel: mats.steel, shelf: mats.shelf, wood: mats.wood, ink: mats.feature, amber: mats.amber, border: mats.border };
  return (
    <group>
      {(Object.keys(byKind) as FittingKind[]).map((k) => (
        <GondolaPart key={k} geometry={UNIT_BOX} material={material[k]} matrices={byKind[k]} />
      ))}
    </group>
  );
}

/** Big lit lightbox fascia above the portal + hanging plaque on the chain crossing. */
function ForRentSigns({ label, mats, info, open }: { label: string; mats: ShopMats; info?: PublicShop; open: boolean }) {
  const fw = W + 1.4; // sign width
  const fh = 1.2;
  const fy = H + 0.2 + 0.2 + fh / 2; // bottom 0.4 m above the frame head
  return (
    <group>
      {/* soft amber halo on the wall behind the lightbox */}
      <mesh position={[0, fy, 0.012]} material={mats.halo}>
        <planeGeometry args={[fw + 0.7, fh + 0.6]} />
      </mesh>
      {/* stand-off brackets */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (fw / 2 - 0.35), fy, 0.06]} material={mats.steel}>
          <boxGeometry args={[0.08, fh - 0.2, 0.12]} />
        </mesh>
      ))}
      {/* lightbox: amber trim, black face */}
      <RoundedBox args={[fw + 0.1, fh + 0.1, 0.16]} radius={0.04} smoothness={3} position={[0, fy, 0.16]} material={mats.amber} castShadow />
      <mesh position={[0, fy, 0.245]} material={mats.sign}>
        <planeGeometry args={[fw - 0.06, fh - 0.06]} />
      </mesh>
      {/* LED edge lines (top + bottom) */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, fy + s * (fh / 2 - 0.09), 0.247]} material={mats.led}>
          <planeGeometry args={[fw - 0.3, 0.025]} />
        </mesh>
      ))}
      <Text position={[0, fy + 0.13, 0.25]} fontSize={Math.min(0.6, (0.6 * 12) / Math.max(12, signTitle(info).length))} maxWidth={fw - 0.3} letterSpacing={0.12} color={AMBER} anchorX="center" anchorY="middle" fontWeight={800} outlineWidth={0.006} outlineColor="#7a5a00">
        {signTitle(info)}
      </Text>
      <Text position={[0, fy - 0.34, 0.25]} fontSize={0.13} letterSpacing={0.3} color="#f6f1e6" anchorX="center" anchorY="middle">
        {open ? `${label}  ·  NOW OPEN  ·  COME IN` : info?.state === "rented" ? `${label}  ·  OPENING SOON` : `${label}  ·  OPEN YOUR SHOP HERE`}
      </Text>
      {/* plaque hanging from the chain crossing */}
      {!open && (
      <group position={[0, 1.18, 0.2]}>
        {[-0.22, 0.22].map((x) => (
          <mesh key={x} position={[x * 0.6, 0.27, 0]} rotation-z={x > 0 ? -0.5 : 0.5} material={mats.brushed}>
            <cylinderGeometry args={[0.004, 0.004, 0.26, 6]} />
          </mesh>
        ))}
        <RoundedBox args={[0.78, 0.38, 0.02]} radius={0.02} smoothness={2} material={mats.plaque} castShadow />
        <Text position={[0, 0.05, 0.012]} fontSize={0.12} letterSpacing={0.06} color="#ffffff" anchorX="center" anchorY="middle" fontWeight={800}>
          {info?.state === "rented" ? "RENTED" : "FOR RENT"}
        </Text>
        <Text position={[0, -0.1, 0.012]} fontSize={0.04} letterSpacing={0.18} color="#ffe9ec" anchorX="center" anchorY="middle">
          {info?.state === "rented" ? "OPENING SOON" : "SELLERS WELCOME"}
        </Text>
      </group>
      )}
    </group>
  );
}

/** Fascia title: the approved brand name, "RESERVED" while it waits for approval, else "FOR RENT". */
function signTitle(info: PublicShop | undefined): string {
  if (info?.state !== "rented") return "FOR RENT";
  return info.brand ? info.brand.toUpperCase() : "RESERVED";
}

function ShopUnitView({ unit, mats, info }: { unit: ShopUnit; mats: ShopMats; info?: PublicShop }) {
  const f = useMemo(() => unitFrame(unit), [unit]);
  // Aim at the shop front + E / tap: the "Rent this shop" panel (hud/ShopRentPanel).
  const root = useRef<THREE.Group>(null);
  const rented = info?.state === "rented";
  const store = rented ? (info?.storefront ?? null) : null;
  const open = !!store;
  const target = useMemo<InteractionTarget>(() => ({ key: `shop:${unit.id}`, kind: "shop", shopId: unit.id, label: unit.label, rented }), [unit.id, unit.label, rented]);
  useInteractable(root, target);
  // The tenant's door look while rented; everyone else gets the house style.
  const door = (rented && info?.door) || DEFAULT_DOOR_STYLE;
  const frame = useFrameMaterial(door.frame);
  return (
    <group ref={root} position={f.position} rotation-y={f.rotationY}>
      <Portal t={f.t} mats={mats} frame={frame} />
      <Storefront mats={mats} open={open} frame={frame} />
      <ShopDoorLights style={door} W={W} H={H} fw={FRAME_W} />
      <Room f={f} label={unit.label} mats={mats} brand={rented && info?.brand ? info.brand.toUpperCase() : store ? store.brand.toUpperCase() : null} store={store} />
      <ForRentSigns label={unit.label} mats={mats} info={info} open={open} />
      {/* padlock at the chain crossing (its face looks along −x: turn it to the store) */}
      {!open && (
        <group position={[0, 1.62, 0.17]} rotation-y={Math.PI / 2}>
          <Padlock position={[0, 0, 0]} />
        </group>
      )}
      {/* chain anchor plates on the frame */}
      {!open &&
        (
          [
            [-W / 2 - 0.08, H - 0.15],
            [W / 2 + 0.08, H - 0.15],
            [-W / 2 - 0.08, 0.35],
            [W / 2 + 0.08, 0.35],
          ] as const
        ).map(([x, y], i) => (
          <group key={i} position={[x, y, 0.09]}>
            <mesh material={mats.brushed}>
              <boxGeometry args={[0.12, 0.12, 0.02]} />
            </mesh>
            <mesh position={[0, 0, 0.03]} material={mats.brushed}>
              <torusGeometry args={[0.035, 0.01, 8, 18]} />
            </mesh>
          </group>
        ))}
    </group>
  );
}

// ───────────────────────────── gondolas (copied from the store) ─────────────────────────────

/** One geometry per material: the copied run, centred on x/z (long axis along +x), standing on y = 0. */
function useGondolaParts(): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
  const { scene } = useGLTF(ASSETS.supermarket.url);
  const parts = useMemo(() => {
    reshapeSupermarket(scene);
    scene.updateMatrixWorld(true);
    const r = GONDOLA_SRC;
    const c = new THREE.Vector3((r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);
    const out: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    const p = new THREE.Vector3();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const g = m.geometry;
      const pos = g.getAttribute("position");
      if (!pos) return;
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
      if (!data.position!.length) return;
      const geo = new THREE.BufferGeometry();
      for (const a of names) geo.setAttribute(a, new THREE.Float32BufferAttribute(data[a]!, g.getAttribute(a).itemSize));
      geo.computeBoundingSphere();
      out.push({ geometry: geo, material: m.material });
    });
    return out;
  }, [scene]);
  useLayoutEffect(() => () => parts.forEach((x) => x.geometry.dispose()), [parts]);
  return parts;
}

/** Two copies of the store's gondola per shop room, running front to back, as one InstancedMesh per material. */
function ShopGondolas() {
  const parts = useGondolaParts();
  const matrices = useMemo(() => {
    const list: THREE.Matrix4[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (const u of SHOP_UNITS) {
      const f = unitFrame(u);
      const unit = frameMatrix(f);
      for (const g of gondolaCenters(f)) {
        const local = new THREE.Matrix4().compose(new THREE.Vector3(g.x, 0, g.z), new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2), new THREE.Vector3(1, 1, 1));
        list.push(unit.clone().multiply(local));
      }
    }
    return list;
  }, []);
  return (
    <group>
      {parts.map((part, i) => (
        <GondolaPart key={i} geometry={part.geometry} material={part.material} matrices={matrices} />
      ))}
    </group>
  );
}

function GondolaPart({ geometry, material, matrices }: { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [matrices]);
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} receiveShadow raycast={() => null} />;
}

/** All shop chains in one InstancedMesh (an X across each closed storefront). */
function ShopChains({ openKey }: { openKey: string }) {
  const { scene } = useGLTF(ASSETS.chain.url);
  const ref = useRef<THREE.InstancedMesh>(null);
  const segments = useMemo(() => {
    const spans: ChainSpan[] = [];
    const open = new Set(openKey.split(","));
    for (const u of SHOP_UNITS) {
      if (open.has(u.id)) continue;
      const f = unitFrame(u);
      const z = 0.14;
      const tl: V3 = [-W / 2 - 0.08, H - 0.15, z];
      const tr: V3 = [W / 2 + 0.08, H - 0.15, z];
      const bl: V3 = [-W / 2 - 0.08, 0.35, z + 0.03];
      const br: V3 = [W / 2 + 0.08, 0.35, z + 0.03];
      spans.push({ from: toWorld(f, tl), to: toWorld(f, br), sag: 0.12 });
      spans.push({ from: toWorld(f, tr), to: toWorld(f, bl), sag: 0.12 });
    }
    return spans.flatMap((s) => chainSegments(s, CHAIN_SEGMENT));
  }, [openKey]);
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
      roll.setFromAxisAngle(xAxis, i % 2 ? Math.PI / 2 : 0);
      q.multiply(roll);
      im.setMatrixAt(i, mat.compose(p.set(...seg.position), q, s.setScalar(seg.scale)));
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [segments]);
  if (!segments.length) return null;
  // key: a new mesh when the count changes (InstancedMesh capacity is fixed at creation).
  return <instancedMesh key={segments.length} ref={ref} args={[geometry, material, segments.length]} castShadow raycast={() => null} />;
}

/** Ids of rented shops whose tenant opened them to shoppers (walk-in, products on the shelves). */
export const openShopIds = (shops?: PublicShop[]) => (shops ?? []).filter((s) => s.state === "rented" && s.storefront).map((s) => s.id);

export function RentalShops({ shops }: { shops?: PublicShop[] }) {
  const mats = useShopMaterials();
  const openKey = openShopIds(shops).join(",");
  return (
    <group>
      <RebuiltWalls />
      {SHOP_UNITS.map((u) => (
        <ShopUnitView key={u.id} unit={u} mats={mats} info={shops?.find((s) => s.id === u.id)} />
      ))}
      <Suspense fallback={null}>
        <ShopChains openKey={openKey} />
      </Suspense>
      <ShopFittings mats={mats} />
      <ShopGondolas />
      {(shops ?? []).map((s) => (s.state === "rented" && s.storefront ? <TenantShelves key={s.id} shopId={s.id} store={s.storefront} /> : null))}
    </group>
  );
}

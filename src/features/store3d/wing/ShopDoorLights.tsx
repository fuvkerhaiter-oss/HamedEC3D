"use client";

/**
 * Neon lighting of a rental shop's door front (style: lib/rentals/door-style.ts, set by the tenant or an admin):
 * a glowing tube around the portal, LED lines on the side pilasters and under the canopy, a light strip on the floor
 * across the entrance, plus soft glow on the wall either side and a light pool on the floor. Every light point is an
 * instance of ONE InstancedMesh per door (per-instance colour, updated in useFrame only for animated effects).
 * Emissive only: no real lights (cheap, no shadow cost).
 *
 * Local frame = the unit's frame in RentalShops (origin at the door centre on the wall's inner face, +z into the
 * store, y up).
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { doorLightLevel, levelScale, rainbowHue, type DoorStyle } from "@/lib/rentals/door-style";

/** One light point: centre, size, and its place `u` (0–1) on the loop that effects like "chase" run along. */
export interface LightSeg {
  p: [number, number, number];
  s: [number, number, number];
  u: number;
}

/** Top of the store's floor tiles in the unit frame (the imported floor sits at y ≈ 0.088). */
export const FLOOR_Y = 0.09;

/** Splits a straight line into ~`step` long boxes, u running from u0 to u1. */
function line(out: LightSeg[], a: [number, number, number], b: [number, number, number], thick: [number, number], u0: number, u1: number, step = 0.12) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
  const len = Math.hypot(d[0], d[1], d[2]);
  const n = Math.max(1, Math.round(len / step));
  const axis = Math.abs(d[0]) > Math.abs(d[1]) ? (Math.abs(d[0]) > Math.abs(d[2]) ? 0 : 2) : Math.abs(d[1]) > Math.abs(d[2]) ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const s: [number, number, number] = [thick[0], thick[0], thick[1]];
    s[axis] = len / n;
    out.push({ p: [a[0] + d[0] * f, a[1] + d[1] * f, a[2] + d[2] * f], s, u: u0 + (u1 - u0) * f });
  }
}

/**
 * Light points of one door (pure: unit-tested). W/H = door opening, fw = frame width. The loop: up the left side of
 * the frame (u 0 → 0.3), across the top (0.3 → 0.5), down the right side (0.5 → 0.8), back along the floor strip
 * (0.8 → 1). Pilaster and canopy lines follow the loop position of the frame next to them.
 */
export function doorLightSegments(W: number, H: number, fw: number): LightSeg[] {
  const out: LightSeg[] = [];
  const X = W / 2 + fw - 0.04; // tube on the outer part of the frame face (clear of the chain anchor plates)
  const top = H + fw - 0.04;
  const z = 0.095;
  const tube: [number, number] = [0.05, 0.04];
  line(out, [-X, FLOOR_Y, z], [-X, top, z], tube, 0, 0.3);
  line(out, [-X, top, z], [X, top, z], tube, 0.3, 0.5);
  line(out, [X, top, z], [X, FLOOR_Y, z], tube, 0.5, 0.8);
  // floor strip across the entrance, right to left (closes the loop)
  line(out, [W / 2, FLOOR_Y + 0.006, 0.28], [-W / 2, FLOOR_Y + 0.006, 0.28], [0.016, 0.05], 0.8, 1, 0.1);
  // LED lines on the pilasters (inner edges), bottom → top on the left, top → bottom on the right
  for (const s of [-1, 1]) {
    const x = s * (W / 2 + fw + 0.2) - s * 0.19;
    line(out, [x, 0.26, 0.056], [x, H + fw, 0.056], [0.028, 0.01], s < 0 ? 0 : 0.8, s < 0 ? 0.3 : 0.5, 0.15);
  }
  // under the canopy's front edge
  line(out, [-(W / 2 + 0.3), H + fw + 0.03, 0.47], [W / 2 + 0.3, H + fw + 0.03, 0.47], [0.016, 0.04], 0.3, 0.5, 0.14);
  return out;
}

// ───────────────────────── soft glow textures (made once, client only) ─────────────────────────

let edgeTex: THREE.Texture | null = null;
let poolTex: THREE.Texture | null = null;

/** 1-D falloff: opaque at u = 0, fading out to u = 1. */
function edgeTexture(): THREE.Texture {
  if (edgeTex) return edgeTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 4;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 4);
  edgeTex = new THREE.CanvasTexture(c);
  edgeTex.colorSpace = THREE.SRGBColorSpace;
  return edgeTex;
}

function poolTexture(): THREE.Texture {
  if (poolTex) return poolTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  poolTex = new THREE.CanvasTexture(c);
  poolTex.colorSpace = THREE.SRGBColorSpace;
  return poolTex;
}

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const DIM = new THREE.Color("#2a2a2a");

const WHITE = new THREE.Color("#ffffff");
const TMP = new THREE.Color();
const BASE = new THREE.Color();
const HALO = new THREE.Color();

export function ShopDoorLights({ style, W, H, fw }: { style: DoorStyle; W: number; H: number; fw: number }) {
  const segs = useMemo(() => doorLightSegments(W, H, fw), [W, H, fw]);
  const ref = useRef<THREE.InstancedMesh>(null);
  // Soft halo around every tube (same points, fatter, additive): reads as neon bloom without post-processing.
  const halo = useRef<THREE.InstancedMesh>(null);
  // Glow materials [left wall, right wall, floor], updated every frame through refs (the R3F way).
  const glow = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const animated = style.effect === "breathe" || style.effect === "chase" || style.effect === "rainbow";

  const paint = (t: number) => {
    const im = ref.current;
    const hm = halo.current;
    if (!im || !hm) return;
    const k = levelScale(style.level);
    BASE.set(style.light);
    let sum = 0;
    for (let i = 0; i < segs.length; i++) {
      const u = segs[i]!.u;
      const a = doorLightLevel(style.effect, t, u) * k;
      sum += a;
      if (style.effect === "rainbow") TMP.setHSL(rainbowHue(t, u), 1, 0.55);
      else TMP.copy(BASE);
      hm.setColorAt(i, HALO.copy(TMP).multiplyScalar(a));
      // An unlit tube still reads as glass: never fully black. Lit: pushed toward white-hot at the core.
      TMP.multiplyScalar(0.1 + 0.9 * a).lerp(DIM, 0.12 * (1 - a)).lerp(WHITE, 0.25 * a);
      im.setColorAt(i, TMP);
    }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    if (hm.instanceColor) hm.instanceColor.needsUpdate = true;
    const avg = sum / segs.length;
    if (style.effect === "rainbow") TMP.setHSL(rainbowHue(t, 0.4), 1, 0.55);
    else TMP.copy(BASE);
    glow.current.forEach((m, i) => {
      if (!m) return;
      m.color.copy(TMP);
      m.opacity = Math.min(1, (i === 2 ? 1.1 : 0.95) * avg);
    });
  };

  useLayoutEffect(() => {
    const im = ref.current;
    const hm = halo.current;
    if (!im || !hm) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const fat = (v: number) => (v > 0.09 ? v : v * 2.5 + 0.08);
    segs.forEach((g, i) => {
      im.setMatrixAt(i, m.compose(p.set(...g.p), q, s.set(...g.s)));
      // flat card (no fattening in depth) so overlapping side faces don't stripe; the floor strip lies flat in y
      const flat = g.p[1] < FLOOR_Y + 0.02 && g.s[1] < 0.05;
      hm.setMatrixAt(i, m.compose(p.set(...g.p), q, s.set(fat(g.s[0]), flat ? g.s[1] : fat(g.s[1]), flat ? fat(g.s[2]) : g.s[2])));
    });
    im.instanceMatrix.needsUpdate = true;
    hm.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    hm.computeBoundingSphere();
    paint(1.1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repaint when the style changes; paint reads it
  }, [segs, style.effect, style.level, style.light]);

  useFrame(({ clock }) => {
    if (animated) paint(clock.elapsedTime);
  });

  const X = W / 2 + fw;
  const glowMat = (i: number, map: THREE.Texture) => (
    <meshBasicMaterial
      ref={(m: THREE.MeshBasicMaterial | null) => {
        glow.current[i] = m;
      }}
      map={map}
      transparent
      opacity={0}
      depthWrite={false}
      toneMapped={false}
      side={THREE.DoubleSide}
    />
  );
  return (
    <group>
      <instancedMesh ref={ref} args={[UNIT, undefined, segs.length]} raycast={() => null} frustumCulled={false}>
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={halo} args={[UNIT, undefined, segs.length]} raycast={() => null} frustumCulled={false} renderOrder={2}>
        <meshBasicMaterial toneMapped={false} transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} />
      </instancedMesh>
      {/* glow washing the pilasters and wall outward from each side of the frame */}
      {[-1, 1].map((s, i) => (
        <mesh key={s} position={[s * (X + 0.6), (H + fw) / 2, 0.064]} rotation-z={s < 0 ? Math.PI : 0} raycast={() => null}>
          <planeGeometry args={[1.2, H + fw + 0.2]} />
          {glowMat(i, edgeTexture())}
        </mesh>
      ))}
      {/* light pool on the floor in front of the door */}
      <mesh position={[0, FLOOR_Y + 0.004, 0.85]} rotation-x={-Math.PI / 2} raycast={() => null}>
        <planeGeometry args={[W + 2.4, 1.9]} />
        {glowMat(2, poolTexture())}
      </mesh>
    </group>
  );
}

"use client";

/**
 * Playful 3D shop front for the rental units: a chunky bevelled "bubble" fascia in the shop's colour with a cream
 * outline, cartoon drop shadow and chasing marquee bulbs; the brand name as fat cartoon lettering (stacked extrusion,
 * thick outline, glossy fill, drawn once into a canvas texture with the site's display font); a big round logo
 * medallion that pops out of the sign, wobbles and bounces, with twinkling stars; and a striped, scalloped awning
 * over the entrance.
 *
 * Local frame = the unit's (origin at the door centre on the wall face, +z into the store, y up). Everything here is
 * static geometry + a few cheap per-frame transforms (no allocations in useFrame).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useImageTexture } from "./image-texture";
import { signFont, DEFAULT_SIGN_FONT } from "@/lib/rentals/sign-fonts";

const CREAM = "#fff3d1";
const INK = "#14110d";
const AMBER = "#f7c416";
/** Shops with no colour of their own (or a near-black one) get this cheerful house colour on the sign + awning. */
const HOUSE_SIGN = "#ff5b2e";

// Sign layout (local metres). Store ceiling is 5.87 m; the door frame ends at 4.2 m.
const BW = 5.3; // board width
const BH = 1.04; // board height
const BOARD_R = 0.46; // corner radius (pill-like)
const DEPTH = 0.12;
const BEVEL = 0.05;
const MED_R = 0.52; // medallion radius
const BULBS = 44;

export interface ShopSignProps {
  /** Door frame height (m) and the width of the frame on each side. */
  H: number;
  W: number;
  fw: number;
  /** Shop colour (#rrggbb); near-black colours are replaced by the house colour. */
  color: string;
  title: string;
  subtitle: string;
  logoUrl: string | null;
  /** Rented shops without a logo show their initial; free shops a shopping bag. */
  rented: boolean;
  /** Animation phase offset so neighbouring shops don't move in sync. */
  phase: number;
  /** Sign font id (lib/rentals/sign-fonts.ts); falls back to bricolage. */
  signFontId?: string | null;
}

function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export function signColor(hex: string): string {
  try {
    return luminance(hex) < 0.06 ? HOUSE_SIGN : hex;
  } catch {
    return HOUSE_SIGN;
  }
}

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Shared geometries (same size for every unit): built once, never disposed (module lifetime). */
let shared: {
  face: THREE.ExtrudeGeometry;
  outline: THREE.ExtrudeGeometry;
  bulbPoints: THREE.Vector2[];
  bulb: THREE.SphereGeometry;
  star: THREE.ShapeGeometry;
} | null = null;
function geometries() {
  if (shared) return shared;
  const bevel = { bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 4, curveSegments: 14 };
  const outlineShape = roundedRect(BW + 0.24, BH + 0.24, BOARD_R + 0.12);
  const star = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 1 : 0.38;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  star.closePath();
  shared = {
    face: new THREE.ExtrudeGeometry(roundedRect(BW, BH, BOARD_R), { depth: DEPTH, ...bevel }),
    outline: new THREE.ExtrudeGeometry(outlineShape, { depth: DEPTH * 0.6, ...bevel }),
    // Bulbs ride on the cream outline, just inside its edge.
    bulbPoints: roundedRect(BW + 0.1, BH + 0.1, BOARD_R + 0.05).getSpacedPoints(BULBS).slice(0, BULBS),
    bulb: new THREE.SphereGeometry(0.045, 10, 8),
    star: new THREE.ShapeGeometry(star),
  };
  return shared;
}

// ───────────────────────────── canvas lettering ─────────────────────────────

/** Loads a sign font CSS variable (next/font; set on <html>), falling back to a heavy system font. */
function useSignFont(fontId: string | null | undefined): string {
  const [family, setFamily] = useState('"Arial Black", "Segoe UI", system-ui, sans-serif');
  useEffect(() => {
    const f = signFont(fontId);
    const v = getComputedStyle(document.documentElement).getPropertyValue(f.cssVar).trim();
    if (!v) return;
    let alive = true;
    document.fonts
      .load(`${f.weight} 100px ${v}`)
      .then(() => alive && setFamily(`${v}, "Arial Black", sans-serif`))
      .catch(() => {});
    return () => { alive = false; };
  }, [fontId]);
  return family;
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

/** Fat cartoon lettering: dark stacked extrusion, thick ink outline, glossy cream→yellow fill and a shine. */
function drawCartoonText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fs: number, base: string, font: string, weight = 800) {
  ctx.font = `${weight} ${fs}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const depth = Math.max(4, Math.round(fs * 0.075));
  // extrusion: ink outline + dark body, back to front
  for (let i = depth; i >= 1; i--) {
    ctx.lineWidth = fs * 0.2;
    ctx.strokeStyle = INK;
    ctx.strokeText(text, x + i * 0.6, y + i);
  }
  for (let i = depth; i >= 1; i--) {
    ctx.fillStyle = shade(base, 0.45);
    ctx.fillText(text, x + i * 0.6, y + i);
  }
  // face
  ctx.lineWidth = fs * 0.12;
  ctx.strokeStyle = INK;
  ctx.strokeText(text, x, y);
  const g = ctx.createLinearGradient(0, y - fs * 0.5, 0, y + fs * 0.5);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.55, CREAM);
  g.addColorStop(1, AMBER);
  ctx.fillStyle = g;
  ctx.fillText(text, x, y);
  // glossy shine across the upper half
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.rect(0, y - fs * 0.5, ctx.canvas.width, fs * 0.28);
  ctx.clip();
  ctx.fillText(text, x, y);
  ctx.restore();
}

function useLetteringTexture(title: string, subtitle: string, base: string, font: string, weight: number): THREE.CanvasTexture | null {
  const tex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const cw = 1600;
    const ch = 400; // aspect matches the text area on the board (~4.0 × 1.0 m)
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    // brand name, as big as fits
    const maxW = cw * 0.92;
    let fs = 230;
    ctx.font = `${weight} ${fs}px ${font}`;
    const w = ctx.measureText(title).width + fs * 0.3;
    if (w > maxW) fs = Math.max(70, (fs * maxW) / w);
    drawCartoonText(ctx, title, cw / 2, ch * 0.4, fs, base, font, weight);
    // subtitle on a little ink pill
    ctx.font = `${weight} 46px ${font}`;
    const sw = Math.min(cw * 0.9, ctx.measureText(subtitle).width + 80);
    const py = ch * 0.86;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(cw / 2 - sw / 2, py - 34, sw, 68, 34);
    ctx.fill();
    ctx.fillStyle = CREAM;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(subtitle, cw / 2, py + 2, cw * 0.86);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [title, subtitle, base, font, weight]);
  useLayoutEffect(() => () => tex?.dispose(), [tex]);
  return tex;
}

/** Medallion face without a logo: the brand initial (rented) or a cheerful shopping bag (free shop). */
function useBadgeTexture(initial: string | null, base: string, font: string): THREE.CanvasTexture | null {
  const tex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const s = 512;
    const c = document.createElement("canvas");
    c.width = s;
    c.height = s;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const g = ctx.createRadialGradient(s * 0.4, s * 0.35, s * 0.05, s / 2, s / 2, s / 2);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, CREAM);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    if (initial) {
      drawCartoonText(ctx, initial, s / 2, s * 0.53, 300, base, font);
    } else {
      // shopping bag: body + handle, ink outlines
      ctx.lineJoin = "round";
      ctx.lineWidth = 22;
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.arc(s / 2, s * 0.36, s * 0.13, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.roundRect(s * 0.24, s * 0.36, s * 0.52, s * 0.42, 34);
      ctx.fill();
      ctx.stroke();
      // smiley on the bag
      ctx.fillStyle = INK;
      for (const ex of [0.42, 0.58]) {
        ctx.beginPath();
        ctx.arc(s * ex, s * 0.5, 14, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(s / 2, s * 0.56, s * 0.08, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [initial, base, font]);
  useLayoutEffect(() => () => tex?.dispose(), [tex]);
  return tex;
}

// ───────────────────────────── pieces ─────────────────────────────

function useMaterials(base: string) {
  const m = useMemo(
    () => ({
      face: new THREE.MeshPhysicalMaterial({ color: base, metalness: 0.15, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 }),
      cream: new THREE.MeshPhysicalMaterial({ color: CREAM, roughness: 0.35, clearcoat: 0.6 }),
      ink: new THREE.MeshStandardMaterial({ color: INK, roughness: 0.7 }),
      amber: new THREE.MeshStandardMaterial({ color: AMBER, metalness: 0.6, roughness: 0.25, emissive: AMBER, emissiveIntensity: 0.25 }),
      bulb: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
      star: new THREE.MeshBasicMaterial({ color: "#ffe066", toneMapped: false, side: THREE.DoubleSide }),
      stripe: new THREE.MeshStandardMaterial({ color: base, roughness: 0.55, side: THREE.DoubleSide }),
      stripeLight: new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.6, side: THREE.DoubleSide }),
      halo: new THREE.MeshBasicMaterial({ color: base, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }),
    }),
    [base],
  );
  useLayoutEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m]);
  return m;
}
type SignMats = ReturnType<typeof useMaterials>;

/** Chasing marquee bulbs around the board (one InstancedMesh; colours updated ~8×/s, no allocations). */
function Bulbs({ mats, phase }: { mats: SignMats; phase: number }) {
  const { bulbPoints, bulb } = geometries();
  const ref = useRef<THREE.InstancedMesh>(null);
  const on = useMemo(() => new THREE.Color("#fff4c2").multiplyScalar(1.6), []);
  const off = useMemo(() => new THREE.Color("#7a5a20"), []);
  const step = useRef(-1);
  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    bulbPoints.forEach((p, i) => {
      im.setMatrixAt(i, m.makeTranslation(p.x, p.y, 0));
      im.setColorAt(i, off);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, [bulbPoints, off]);
  useFrame(({ clock }) => {
    const im = ref.current;
    if (!im) return;
    const s = Math.floor((clock.elapsedTime + phase) * 8);
    if (s === step.current) return;
    step.current = s;
    for (let i = 0; i < BULBS; i++) im.setColorAt(i, (i + s) % 3 === 0 ? on : off);
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[bulb, mats.bulb, BULBS]} raycast={() => null} />;
}

/** Big round badge that pops out of the sign: logo (or initial / bag), cream ring, gold rim, wobble + bounce. */
function Medallion({ mats, logoUrl, initial, base, font, phase }: { mats: SignMats; logoUrl: string | null; initial: string | null; base: string; font: string; phase: number }) {
  const logo = useImageTexture(logoUrl, 640);
  const badge = useBadgeTexture(initial, base, font);
  const tex = logo ?? badge;
  const ref = useRef<THREE.Group>(null);
  const stars = useRef<THREE.Group>(null);
  const { star } = geometries();
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase;
    const g = ref.current;
    if (g) {
      g.rotation.z = Math.sin(t * 1.7) * 0.09;
      g.rotation.y = Math.sin(t * 0.9) * 0.18;
      const k = 1 + Math.max(0, Math.sin(t * 2.6)) * 0.05;
      g.scale.set(k, k, 1);
    }
    const s = stars.current;
    if (s) {
      s.children.forEach((c, i) => {
        const k = 0.6 + 0.4 * Math.abs(Math.sin(t * 2.2 + i * 1.9));
        c.scale.setScalar(k * (i === 0 ? 0.16 : 0.11));
        c.rotation.z = t * (i % 2 ? -0.8 : 0.8);
      });
    }
  });
  return (
    <group>
      <group ref={ref}>
        {/* cream back ring + coloured drum + gold rim */}
        <mesh rotation-x={Math.PI / 2} position={[0, 0, -0.05]} material={mats.cream} castShadow>
          <cylinderGeometry args={[MED_R + 0.08, MED_R + 0.08, 0.1, 48]} />
        </mesh>
        <mesh rotation-x={Math.PI / 2} position={[0, 0, 0.04]} material={mats.face}>
          <cylinderGeometry args={[MED_R, MED_R, 0.16, 48]} />
        </mesh>
        <mesh position={[0, 0, 0.12]} material={mats.amber}>
          <torusGeometry args={[MED_R - 0.02, 0.055, 12, 48]} />
        </mesh>
        <mesh position={[0, 0, 0.125]}>
          <circleGeometry args={[MED_R - 0.08, 48]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        {tex && (
          <mesh position={[0, 0, 0.13]}>
            <circleGeometry args={[MED_R - 0.12, 48]} />
            <meshBasicMaterial map={tex} toneMapped={false} />
          </mesh>
        )}
      </group>
      <group ref={stars}>
        <mesh geometry={star} material={mats.star} position={[MED_R * 0.95, MED_R * 0.85, 0.2]} />
        <mesh geometry={star} material={mats.star} position={[-MED_R * 0.9, -MED_R * 0.75, 0.2]} />
        <mesh geometry={star} material={mats.star} position={[-MED_R * 1.05, MED_R * 0.55, 0.2]} />
      </group>
    </group>
  );
}

/** Striped, scalloped awning over the door: sloped stripes, rounded valance, a cream roll bar and side cheeks. */
function Awning({ W, top, mats }: { W: number; top: number; mats: SignMats }) {
  const AW = W + 1.0;
  const N = 9;
  const sw = AW / N;
  const reach = 0.95; // out from the wall
  const drop = 0.42; // front edge lower than the back
  const len = Math.hypot(reach, drop);
  const slope = Math.atan2(drop, reach);
  const frontY = top - drop;
  const cheek = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(reach, -drop);
    s.lineTo(reach, -drop - 0.22);
    s.lineTo(0, -0.12);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  }, [drop]);
  useLayoutEffect(() => () => cheek.dispose(), [cheek]);
  return (
    <group>
      {Array.from({ length: N }, (_, i) => {
        const x = -AW / 2 + sw * (i + 0.5);
        const m = i % 2 === 0 ? mats.stripe : mats.stripeLight;
        return (
          <group key={i}>
            <mesh position={[x, top - drop / 2, 0.05 + reach / 2]} rotation-x={slope} material={m} castShadow>
              <boxGeometry args={[sw + 0.002, 0.035, len]} />
            </mesh>
            {/* scalloped valance */}
            <mesh position={[x, frontY - 0.02, 0.05 + reach + 0.01]} material={m}>
              <circleGeometry args={[sw / 2, 20, Math.PI, Math.PI]} />
            </mesh>
            <mesh position={[x, frontY + 0.06, 0.05 + reach + 0.01]} material={m}>
              <planeGeometry args={[sw + 0.002, 0.16]} />
            </mesh>
          </group>
        );
      })}
      <mesh position={[0, frontY + 0.14, 0.05 + reach]} rotation-z={Math.PI / 2} material={mats.cream} castShadow>
        <cylinderGeometry args={[0.06, 0.06, AW + 0.12, 20]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={cheek} material={mats.stripe} position={[s * (AW / 2 + 0.005), top, 0.05]} rotation-y={-Math.PI / 2} />
      ))}
    </group>
  );
}

// ───────────────────────────── the whole front ─────────────────────────────

export function ShopSign({ H, W, fw, color, title, subtitle, logoUrl, rented, phase, signFontId }: ShopSignProps) {
  const base = signColor(color);
  const mats = useMaterials(base);
  const sf = signFont(signFontId);
  const fontFamily = useSignFont(signFontId);
  const displayTitle = sf.upper ? title.toUpperCase() : title;
  const lettering = useLetteringTexture(displayTitle, subtitle, base, fontFamily, sf.weight);
  const { face, outline } = geometries();
  const awningTop = H + fw + 0.18;
  const fy = awningTop + 0.12 + BH / 2; // board centre: outline top ≈ 5.71 m, cleanly below the 5.87 m ceiling
  const medX = -BW / 2 + 0.35;
  const initial = rented ? (title.trim().charAt(0) || "★").toUpperCase() : null;
  const sway = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = sway.current;
    if (g) g.rotation.z = Math.sin((clock.elapsedTime + phase) * 0.8) * 0.006;
  });
  return (
    <group>
      <Awning W={W} top={awningTop} mats={mats} />
      {/* soft glow on the wall behind the sign */}
      <mesh position={[0, fy, 0.01]} material={mats.halo} raycast={() => null}>
        <planeGeometry args={[BW + 1.4, BH + 0.55]} />
      </mesh>
      <group ref={sway} position={[0, fy, 0.08]}>
        {/* cartoon drop shadow, cream outline, coloured face */}
        <mesh geometry={outline} material={mats.ink} position={[0.07, -0.08, -0.02]} />
        <mesh geometry={outline} material={mats.cream} position={[0, 0, 0.02]} castShadow />
        <mesh geometry={face} material={mats.face} position={[0, 0, 0.07]} castShadow />
        <group position={[0, 0, 0.07 + DEPTH + BEVEL + 0.012]}>
          <Bulbs mats={mats} phase={phase} />
        </group>
        {lettering && (
          <mesh position={[0.45, 0, 0.07 + DEPTH + BEVEL + 0.006]} raycast={() => null}>
            <planeGeometry args={[BW - 1.3, BH - 0.08]} />
            <meshBasicMaterial map={lettering} transparent toneMapped={false} />
          </mesh>
        )}
        <group position={[medX, 0.02, 0.07 + DEPTH + BEVEL + 0.1]}>
          <Medallion mats={mats} logoUrl={logoUrl} initial={initial} base={base} font={fontFamily} phase={phase} />
        </group>
      </group>
    </group>
  );
}

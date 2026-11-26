"use client";

/**
 * "Who supported us from the beginning": a big, white, free-standing sign (like a giant leaflet on a stand) in the
 * new hall beside the chained "Coming soon" wing. Always there, fixed in place (collider in ../env/extension.ts).
 * The names table is a canvas texture holding only the visible rows (+1); smooth scrolling moves the texture
 * offset and the canvas is redrawn only when the list passes a whole row. Long lists scroll slowly by themselves
 * (looping, with a gap); standing in front of it the shopper scrolls with the mouse wheel (desktop) or the HUD
 * arrows (touch, ./supporters-scroll). Content: store_settings `storefront.supporters` (/admin/supporters).
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Text } from "@react-three/drei";
import { countryName, DEFAULT_SUPPORTERS_TITLE, type SupportersWall } from "@/lib/storefront/supporters";
import { GATE_X, SUPPORTERS_STAND } from "../env/extension";
import { useStoreUi } from "../ui-store";
import { onSupportersNudge, useSupportersScroll } from "./supporters-scroll";

const WHITE = "#fbfaf7";
const INK = "#111513";
const SOFT = "#5d6662";
const GREEN = "#12392b";
const AMBER = "#f7c416";
const AMBER_DEEP = "#b8860b";
const ROW_TINT = "#f1efe9";

// Sign (panel-local metres, origin = panel centre).
const W = SUPPORTERS_STAND.width;
const H = 3.4;
const BOTTOM = 0.42; // panel bottom above the floor
const PAD = 0.2;

// Names table viewport.
const LIST_W = W - PAD * 2;
const LIST_TOP = 0.52;
const LIST_H = 1.98;
const ROWS = 9;
const ROW_M = LIST_H / ROWS;
const ROW_PX = 96;
const PX_PER_M = ROW_PX / ROW_M;
const CANVAS_W = Math.round(LIST_W * PX_PER_M);
const CANVAS_H = (ROWS + 1) * ROW_PX;
const GAP_ROWS = 2; // blank rows between the end and the start of a looping list
const NUM_X = 22; // px
const NAME_X = 104; // px

const NEAR = 6; // m: scroll controls active
const NEAR_OFF = 7;
const AUTO_RANGE = 14; // m: auto-scroll while the sign is in sight
const AUTO_SPEED = 0.5; // rows per second
const MANUAL_PAUSE = 4; // s without auto-scroll after the shopper scrolls

const mod = (a: number, n: number) => ((a % n) + n) % n;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h); // older Safari
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
  return s + "…";
}

/** Draws rows base … base+ROWS (one extra for the partial row). */
function drawRows(ctx: CanvasRenderingContext2D, wall: SupportersWall, base: number, loop: boolean) {
  const n = wall.people.length;
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.textBaseline = "middle";
  if (n === 0) {
    ctx.textAlign = "center";
    ctx.fillStyle = INK;
    ctx.font = `700 46px ${FONT}`;
    ctx.fillText("First supporters coming soon", CANVAS_W / 2, CANVAS_H / 2 - 30);
    ctx.fillStyle = SOFT;
    ctx.font = `400 32px ${FONT}`;
    ctx.fillText("Thank you for being here from day one.", CANVAS_W / 2, CANVAS_H / 2 + 28);
    return;
  }
  const len = loop ? n + GAP_ROWS : n;
  for (let i = 0; i <= ROWS; i++) {
    const idx = loop ? mod(base + i, len) : base + i;
    const y = i * ROW_PX;
    const mid = y + ROW_PX / 2 + 1;
    if (idx >= n) {
      if (loop && idx === n) {
        // Loop gap: a small divider before the list starts again.
        ctx.fillStyle = AMBER;
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath();
          ctx.arc(CANVAS_W / 2 + k * 28, mid, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      continue;
    }
    const p = wall.people[idx]!;
    if (idx % 2 === 0) {
      ctx.fillStyle = ROW_TINT;
      ctx.beginPath();
      pill(ctx, 0, y + 5, CANVAS_W, ROW_PX - 10, 16);
      ctx.fill();
    }
    ctx.textAlign = "left";
    ctx.fillStyle = AMBER_DEEP;
    ctx.font = `700 28px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillText(String(idx + 1).padStart(n >= 100 ? 3 : 2, "0"), NUM_X, mid);

    let right = CANVAS_W - 22;
    if (p.country) {
      ctx.font = `500 31px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillStyle = SOFT;
      const shown = ellipsize(ctx, countryName(p.country), CANVAS_W * 0.3);
      ctx.fillText(shown, right, mid);
      right -= ctx.measureText(shown).width + 16;
      const bw = 64;
      ctx.fillStyle = GREEN;
      ctx.beginPath();
      pill(ctx, right - bw, mid - 20, bw, 40, 20);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 24px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(p.country, right - bw / 2, mid + 1);
      right -= bw + 24;
    }
    ctx.textAlign = "left";
    ctx.fillStyle = INK;
    ctx.font = `600 42px ${FONT}`;
    ctx.fillText(ellipsize(ctx, p.name, right - NAME_X), NAME_X, mid);
  }
}

/** Vertical alpha ramp so names fade in/out at the table edges (green channel = alpha). */
function fadeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#000");
  grad.addColorStop(0.08, "#fff");
  grad.addColorStop(0.92, "#fff");
  grad.addColorStop(1, "#000");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
}

/** Development only: `?supporters-demo=N` fills the sign with N labelled demo rows to check the layout/scrolling. */
export function supportersDevDemo(): SupportersWall | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const n = Number(new URLSearchParams(window.location.search).get("supporters-demo"));
  if (!n) return null;
  const cc = ["IT", "US", "TN", "FR", "DE", "ES", "GB", "CA", "BR", "JP", "MA", "NL"];
  return { title: DEFAULT_SUPPORTERS_TITLE, people: Array.from({ length: Math.min(n, 500) }, (_, i) => ({ name: `Demo supporter ${i + 1}`, country: cc[i % cc.length]! })) };
}

export function SupportersBoard({ wall: wallIn }: { wall?: SupportersWall }) {
  const wall = useMemo(() => supportersDevDemo() ?? wallIn ?? { title: DEFAULT_SUPPORTERS_TITLE, people: [] }, [wallIn]);
  const n = wall.people.length;
  const loop = n > ROWS;
  const len = loop ? n + GAP_ROWS : n;
  const countries = useMemo(() => new Set(wall.people.map((p) => p.country).filter(Boolean)).size, [wall]);
  const touch = useStoreUi((s) => s.touchMode);

  const listMat = useRef<THREE.MeshBasicMaterial>(null);
  const scroll = useRef({ pos: 0, target: 0, base: Number.NaN, manualAt: -Infinity, near: false });

  const { ctx, tex, fade } = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = CANVAS_W;
    c.height = CANVAS_H;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.repeat.set(1, ROWS / (ROWS + 1));
    return { ctx: c.getContext("2d")!, tex: t, fade: fadeTexture() };
  }, []);
  useEffect(() => () => {
    tex.dispose();
    fade.dispose();
  }, [tex, fade]);

  // New content: restart from the top.
  useEffect(() => {
    const s = scroll.current;
    s.pos = s.target = 0;
    s.base = Number.NaN;
  }, [wall]);

  // Manual scrolling: mouse wheel while playing and HUD arrows on touch, only standing in front of the sign.
  useEffect(() => {
    const scrollBy = (rows: number) => {
      const s = scroll.current;
      if (!s.near || !loop) return;
      s.target += rows;
      s.manualAt = performance.now() / 1000;
    };
    const onWheel = (e: WheelEvent) => {
      const ui = useStoreUi.getState();
      if (!ui.locked || ui.openProductId) return;
      const px = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * 600 : e.deltaY;
      scrollBy(Math.max(-4, Math.min(4, px / 100)));
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    const off = onSupportersNudge(scrollBy);
    return () => {
      window.removeEventListener("wheel", onWheel);
      off();
      useSupportersScroll.getState().setNear(false, false);
    };
  }, [loop]);

  useFrame(({ camera }, dt) => {
    const s = scroll.current;
    const dist = Math.hypot(camera.position.x - SUPPORTERS_STAND.x, camera.position.z - SUPPORTERS_STAND.z);
    const inHall = camera.position.x < GATE_X;
    const near = inHall && dist < (s.near ? NEAR_OFF : NEAR);
    if (near !== s.near) {
      s.near = near;
      useSupportersScroll.getState().setNear(near, loop);
    }
    const step = Math.min(dt, 0.05);
    if (loop) {
      if (dist < AUTO_RANGE && performance.now() / 1000 - s.manualAt > MANUAL_PAUSE) s.target += AUTO_SPEED * step;
      s.pos += (s.target - s.pos) * Math.min(1, step * 9);
      if (Math.abs(s.pos) > len * 4) {
        // Keep both numbers small without a visible jump.
        const shift = Math.floor(s.pos / len) * len;
        s.pos -= shift;
        s.target -= shift;
      }
    } else {
      s.pos = s.target = 0;
    }
    const map = listMat.current?.map;
    if (!map) return;
    const base = Math.floor(s.pos);
    if (base !== s.base) {
      s.base = base;
      drawRows(ctx, wall, base, loop);
      map.needsUpdate = true;
    }
    map.offset.y = (1 - (s.pos - base)) / (ROWS + 1);
  });

  const L = -W / 2 + PAD;
  const R = W / 2 - PAD;
  const cy = BOTTOM + H / 2;
  const footer = n === 0 ? "THANK YOU FOR BEING HERE" : !loop ? "THANK YOU, ALL OF YOU" : touch ? "WALK UP · USE THE ARROWS TO SCROLL" : "WALK UP · SCROLL THE MOUSE WHEEL TO SEE ALL NAMES";

  return (
    <group position={[SUPPORTERS_STAND.x, 0, SUPPORTERS_STAND.z]} rotation-y={SUPPORTERS_STAND.yaw}>
      {/* Stand: base plinth + two posts. */}
      <RoundedBox args={[W + 0.2, 0.14, SUPPORTERS_STAND.depth]} radius={0.05} smoothness={3} position={[0, 0.07, 0]}>
        <meshStandardMaterial color={GREEN} roughness={0.5} metalness={0.2} />
      </RoundedBox>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (W / 2 - 0.3), (BOTTOM + 0.14) / 2, -0.04]}>
          <boxGeometry args={[0.07, BOTTOM - 0.14 + 0.1, 0.07]} />
          <meshStandardMaterial color="#c8ccc9" roughness={0.3} metalness={0.8} />
        </mesh>
      ))}

      <group position={[0, cy, 0]}>
        {/* Green frame + back, white lit face. */}
        <RoundedBox args={[W + 0.12, H + 0.12, 0.08]} radius={0.06} smoothness={3} position={[0, 0, -0.045]}>
          <meshStandardMaterial color={GREEN} roughness={0.45} metalness={0.15} />
        </RoundedBox>
        <mesh position={[0, 0, 0.001]}>
          <planeGeometry args={[W, H]} />
          <meshBasicMaterial color={WHITE} toneMapped={false} />
        </mesh>
        <mesh position={[0, H / 2 - 0.04, 0.003]}>
          <planeGeometry args={[W, 0.08]} />
          <meshBasicMaterial color={AMBER} toneMapped={false} />
        </mesh>

        <group position={[0, 0, 0.006]}>
          <Text position={[L, H / 2 - 0.25, 0]} fontSize={0.085} letterSpacing={0.28} color={GREEN} anchorX="left" anchorY="middle">
            WEGO SHIIIP · THANK YOU
          </Text>
          <Heart position={[R - 0.06, H / 2 - 0.25, 0]} />
          <Text position={[L, H / 2 - 0.36, 0]} fontSize={0.2} lineHeight={1.1} maxWidth={R - L} color={INK} anchorX="left" anchorY="top" fontWeight={700}>
            {wall.title}
          </Text>
          <Text position={[L, H / 2 - 0.88, 0]} fontSize={0.075} letterSpacing={0.1} color={SOFT} anchorX="left" anchorY="middle">
            {n === 0 ? "OUR FIRST SUPPORTERS" : `${n} ${n === 1 ? "SUPPORTER" : "SUPPORTERS"}${countries ? ` · ${countries} ${countries === 1 ? "COUNTRY" : "COUNTRIES"}` : ""}`}
          </Text>

          {/* Table header */}
          {n > 0 && (
            <group position={[0, LIST_TOP + 0.13, 0]}>
              <Text position={[L + NUM_X / PX_PER_M, 0, 0]} fontSize={0.058} letterSpacing={0.16} color={SOFT} anchorX="left" anchorY="middle">#</Text>
              <Text position={[L + NAME_X / PX_PER_M, 0, 0]} fontSize={0.058} letterSpacing={0.16} color={SOFT} anchorX="left" anchorY="middle">NAME</Text>
              <Text position={[R - 22 / PX_PER_M, 0, 0]} fontSize={0.058} letterSpacing={0.16} color={SOFT} anchorX="right" anchorY="middle">COUNTRY</Text>
            </group>
          )}
          <mesh position={[0, LIST_TOP + 0.05, 0]}>
            <planeGeometry args={[R - L, 0.008]} />
            <meshBasicMaterial color={INK} />
          </mesh>

          {/* Names table */}
          <mesh position={[0, LIST_TOP - LIST_H / 2, 0.001]}>
            <planeGeometry args={[LIST_W, LIST_H]} />
            <meshBasicMaterial ref={listMat} map={tex} alphaMap={fade} transparent toneMapped={false} depthWrite={false} />
          </mesh>
          {loop && <ScrollBar x={R + 0.1} top={LIST_TOP} h={LIST_H} state={scroll} len={len} />}
        </group>

        {/* Footer strip */}
        <mesh position={[0, -H / 2 + 0.13, 0.003]}>
          <planeGeometry args={[W, 0.26]} />
          <meshBasicMaterial color={GREEN} toneMapped={false} />
        </mesh>
        <Text position={[0, -H / 2 + 0.13, 0.008]} fontSize={0.064} letterSpacing={0.14} color={WHITE} anchorX="center" anchorY="middle">
          {footer}
        </Text>
      </group>
    </group>
  );
}

/** Thin track + thumb showing where in the list the shopper is. */
function ScrollBar({ x, top, h, state, len }: { x: number; top: number; h: number; state: React.RefObject<{ pos: number }>; len: number }) {
  const thumb = useRef<THREE.Mesh>(null);
  const th = Math.max(0.14, (h * ROWS) / len);
  useFrame(() => {
    if (!thumb.current) return;
    thumb.current.position.y = top - th / 2 - (mod(state.current.pos, len) / len) * (h - th);
  });
  return (
    <group>
      <mesh position={[x, top - h / 2, 0]}>
        <planeGeometry args={[0.014, h]} />
        <meshBasicMaterial color="#dcd9d1" toneMapped={false} />
      </mesh>
      <mesh ref={thumb} position={[x, top - th / 2, 0.001]}>
        <planeGeometry args={[0.026, th]} />
        <meshBasicMaterial color={GREEN} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Heart({ position }: { position: [number, number, number] }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    const k = 0.0014;
    s.moveTo(0, -30 * k);
    s.bezierCurveTo(-5 * k, -25 * k, -40 * k, -5 * k, -40 * k, 15 * k);
    s.bezierCurveTo(-40 * k, 35 * k, -15 * k, 42 * k, 0, 25 * k);
    s.bezierCurveTo(15 * k, 42 * k, 40 * k, 35 * k, 40 * k, 15 * k);
    s.bezierCurveTo(40 * k, -5 * k, 5 * k, -25 * k, 0, -30 * k);
    return s;
  }, []);
  return (
    <mesh position={position}>
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial color={AMBER_DEEP} toneMapped={false} />
    </mesh>
  );
}

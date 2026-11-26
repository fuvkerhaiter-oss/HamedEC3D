"use client";

/**
 * Live store map. Compact (top-right) while playing; N (or a tap on it) opens the large map with aisle departments,
 * every landmark and a legend. Drawn on two canvases: a static layer (floor, walls, gondolas, landmarks, labels)
 * rendered once per size, and a live layer redrawn ~30×/s with the shopper (arrow + view cone), the demo bots and
 * the other shoppers in the room (../map/map-live, multiplayer/net). Pure DOM: no work in the 3D render loop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Sign } from "../layout";
import { STORE_ENV } from "../env/supermarket";
import { GATE, GATE_X, LUCKY_WHEEL, NEW_END_X, OLD_END_X, SUPPORTERS_STAND } from "../env/extension";
import { HALL_WALL, SHOP_DOOR, SHOP_UNITS, SIDE_WALL, wallOf } from "../env/shops";
import { aisleLabels, headingUpRotation, MAP_BOUNDS, mapFrame, mapHeading, type MapFrame } from "../map/map-geometry";

const MAP_W = MAP_BOUNDS.maxX - MAP_BOUNDS.minX;
import { mapLive } from "../map/map-live";
import { remotePoses, useNet } from "../multiplayer/net";
import { useStoreUi } from "../ui-store";

const C = {
  panel: "rgba(13,19,17,0.82)",
  floor: "#1f2a26",
  hall: "#1c2622",
  wing: "#121816",
  wall: "#e9e3d6",
  gondola: "#56665f",
  gondolaEdge: "#7d8c85",
  fixture: "#3e4b46",
  amber: "#f7c416",
  cream: "#f3ede0",
  soft: "rgba(243,237,224,0.62)",
  green: "#2f8f5b",
  red: "#c8102e",
  player: "#f7c416",
};
const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif';

/** Main entrance: the glazed opening in the store's south wall (supermarket.glb). */
const ENTRANCE = { x0: -12.22, x1: -7.69, z: -6.77 };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, weight = 700, align: CanvasTextAlign = "center") {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, size * 0.28);
  ctx.strokeStyle = "rgba(10,14,13,0.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Static layer: the building and everything fixed in it. */
function drawStatic(ctx: CanvasRenderingContext2D, f: MapFrame, signs: Sign[], large: boolean) {
  const { px, py, s } = f;
  const env = STORE_ENV;
  const z0 = env.interior.min[2];
  const z1 = env.interior.max[2];
  const x0 = env.interior.min[0];
  const rect = (ax: number, az: number, bx: number, bz: number) => [px(Math.min(ax, bx)), py(Math.min(az, bz)), Math.abs(bx - ax) * s, Math.abs(bz - az) * s] as const;

  ctx.clearRect(0, 0, f.width, f.height);

  // Rental shop rooms behind the walls (faint), so the shops read as real spaces.
  for (const u of SHOP_UNITS) {
    const w = wallOf(u);
    const outer = w.outer;
    const depth = large ? 2.2 : 1.6;
    const zz = u.side === "N" ? outer + depth : outer - depth;
    const [x, y, ww, hh] = rect(u.roomX0 + 0.2, outer, u.roomX1 - 0.2, zz);
    ctx.fillStyle = "rgba(247,196,22,0.10)";
    roundRect(ctx, x, y, ww, hh, 3);
    ctx.fill();
  }

  // Floors: store, new hall, coming-soon wing.
  const gateX = GATE_X;
  ctx.fillStyle = C.floor;
  ctx.fillRect(...rect(x0, z0, OLD_END_X, z1));
  ctx.fillStyle = C.hall;
  ctx.fillRect(...rect(OLD_END_X, z0, gateX, z1));
  ctx.fillStyle = C.wing;
  ctx.fillRect(...rect(gateX, z0, NEW_END_X, z1));
  // Hatching on the closed wing.
  ctx.save();
  ctx.beginPath();
  ctx.rect(...rect(gateX, z0, NEW_END_X, z1));
  ctx.clip();
  ctx.strokeStyle = "rgba(247,196,22,0.10)";
  ctx.lineWidth = 1;
  for (let x = px(gateX) - f.height; x < px(NEW_END_X); x += 7) {
    ctx.beginPath();
    ctx.moveTo(x, py(z0));
    ctx.lineTo(x + (z1 - z0) * s, py(z1));
    ctx.stroke();
  }
  ctx.restore();

  // Fixtures (wall racks, counters…) then the gondola runs.
  ctx.fillStyle = C.fixture;
  for (const b of env.fixtures) {
    if (b.max[1] < 0.3) continue;
    ctx.fillRect(...rect(b.min[0], b.min[2], b.max[0], b.max[2]));
  }
  for (const r of env.runs) {
    const [x, y, w, h] = rect(r.box.min[0], r.box.min[2], r.box.max[0], r.box.max[2]);
    ctx.fillStyle = C.gondola;
    roundRect(ctx, x, y, w, h, Math.min(3, h / 2));
    ctx.fill();
    ctx.strokeStyle = C.gondolaEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Checkout.
  if (env.checkout) {
    const [x, y, w, h] = rect(env.checkout.min[0], env.checkout.min[2], env.checkout.max[0], env.checkout.max[2]);
    ctx.fillStyle = "rgba(47,143,91,0.85)";
    roundRect(ctx, x, y, w, h, 2);
    ctx.fill();
  }

  // Walls (outline) with gaps for the entrance and the shop doors.
  ctx.strokeStyle = C.wall;
  ctx.lineWidth = Math.max(2, s * 0.22);
  ctx.lineCap = "round";
  const wallLine = (z: number, from: number, to: number, gaps: [number, number][]) => {
    let cur = from;
    for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
      if (a > cur) {
        ctx.beginPath();
        ctx.moveTo(px(cur), py(z));
        ctx.lineTo(px(a), py(z));
        ctx.stroke();
      }
      cur = Math.max(cur, b);
    }
    if (cur < to) {
      ctx.beginPath();
      ctx.moveTo(px(cur), py(z));
      ctx.lineTo(px(to), py(z));
      ctx.stroke();
    }
  };
  const doors = (side: "N" | "S") => SHOP_UNITS.filter((u) => u.side === side).map((u) => [u.x - SHOP_DOOR.width / 2, u.x + SHOP_DOOR.width / 2] as [number, number]);
  wallLine(z1, x0, NEW_END_X, doors("N"));
  wallLine(z0, x0, NEW_END_X, [...doors("S"), [ENTRANCE.x0, ENTRANCE.x1]]);
  ctx.beginPath();
  ctx.moveTo(px(x0), py(z0));
  ctx.lineTo(px(x0), py(z1));
  ctx.moveTo(px(NEW_END_X), py(z0));
  ctx.lineTo(px(NEW_END_X), py(z1));
  ctx.stroke();

  // Gate: pillars + chains (dashed amber).
  ctx.fillStyle = C.wall;
  ctx.fillRect(...rect(gateX - GATE.pillarDepth / 2, z0, gateX + GATE.pillarDepth / 2, z0 + GATE.pillarWidth));
  ctx.fillRect(...rect(gateX - GATE.pillarDepth / 2, z1 - GATE.pillarWidth, gateX + GATE.pillarDepth / 2, z1));
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = C.amber;
  ctx.lineWidth = Math.max(1.5, s * 0.12);
  ctx.beginPath();
  ctx.moveTo(px(gateX - 0.4), py(z0 + GATE.pillarWidth));
  ctx.lineTo(px(gateX - 0.4), py(z1 - GATE.pillarWidth));
  ctx.stroke();
  ctx.restore();

  // Entrance marker.
  ctx.strokeStyle = C.green;
  ctx.lineWidth = Math.max(2.5, s * 0.25);
  ctx.beginPath();
  ctx.moveTo(px(ENTRANCE.x0), py(ENTRANCE.z));
  ctx.lineTo(px(ENTRANCE.x1), py(ENTRANCE.z));
  ctx.stroke();

  // Shop doors (amber) + labels outside the wall.
  for (const u of SHOP_UNITS) {
    const z = (u.wall === "hall" ? HALL_WALL : SIDE_WALL)[u.side].inner;
    ctx.strokeStyle = C.amber;
    ctx.lineWidth = Math.max(2.5, s * 0.28);
    ctx.beginPath();
    ctx.moveTo(px(u.x - SHOP_DOOR.width / 2), py(z));
    ctx.lineTo(px(u.x + SHOP_DOOR.width / 2), py(z));
    ctx.stroke();
    const out = u.side === "N" ? 1 : -1;
    if (!large) continue; // the rotating compact map draws its labels upright itself
    {
      label(ctx, u.label, px(u.x), py(z + out * 0.95), Math.max(10, s * 0.55), C.amber, 800);
      label(ctx, "FOR RENT", px(u.x), py(z + out * 1.75), Math.max(8, s * 0.36), C.cream, 700);
    }
  }

  // Lucky wheel (gold disc) and supporters sign.
  const wheelR = Math.max(4, 1.5 * s);
  ctx.fillStyle = "rgba(214,162,62,0.95)";
  ctx.beginPath();
  ctx.arc(px(LUCKY_WHEEL.x), py(LUCKY_WHEEL.z), wheelR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.red;
  ctx.lineWidth = Math.max(1, wheelR * 0.25);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(px(LUCKY_WHEEL.x), py(LUCKY_WHEEL.z));
    ctx.lineTo(px(LUCKY_WHEEL.x) + Math.cos(a) * wheelR * 0.85, py(LUCKY_WHEEL.z) + Math.sin(a) * wheelR * 0.85);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(px(SUPPORTERS_STAND.x), py(SUPPORTERS_STAND.z));
  ctx.rotate(-SUPPORTERS_STAND.yaw); // world yaw about +Y is clockwise→counter-clockwise on a +z-down map
  ctx.fillStyle = C.cream;
  ctx.fillRect((-SUPPORTERS_STAND.width / 2) * s, -0.2 * s, SUPPORTERS_STAND.width * s, 0.4 * s);
  ctx.restore();

  // Labels.
  if (large) {
    for (const a of aisleLabels(signs)) {
      const short = a.text.length > 34 ? `${a.text.slice(0, 33)}…` : a.text;
      label(ctx, short, px(a.x), py(a.z), Math.max(9, s * 0.42), C.soft, 600);
    }
    label(ctx, "CHECKOUT", px(-10.9), py(4.7), Math.max(9, s * 0.42), "#7fe0a8", 800);
    label(ctx, "ENTRANCE", px((ENTRANCE.x0 + ENTRANCE.x1) / 2), py(ENTRANCE.z - 0.9), Math.max(10, s * 0.48), "#7fe0a8", 800);
    label(ctx, "NEW HALL", px((OLD_END_X + gateX) / 2), py(1.6), Math.max(10, s * 0.5), C.soft, 800);
    label(ctx, "LUCKY WHEEL", px(LUCKY_WHEEL.x), py(LUCKY_WHEEL.z - 2.3), Math.max(9, s * 0.42), C.amber, 800);
    label(ctx, "SUPPORTERS", px(SUPPORTERS_STAND.x), py(SUPPORTERS_STAND.z - 1.4), Math.max(9, s * 0.4), C.cream, 700);
    label(ctx, "COMING SOON", px((gateX + NEW_END_X) / 2), py((z0 + z1) / 2), Math.max(12, s * 0.8), C.amber, 800);
  }
}

/** Bots + other shoppers, in map coordinates of the current transform. */
function drawOthers(ctx: CanvasRenderingContext2D, f: MapFrame, dotR: number, names: boolean) {
  const { px, py, s } = f;
  for (const b of mapLive.bots) {
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(px(b.x), py(b.z), dotR * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(10,14,13,0.9)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const { members, me } = useNet.getState();
  const now = performance.now();
  for (const m of members) {
    if (m.id === me.id) continue;
    const r = remotePoses.get(m.id);
    if (!r || now - r.at > 5000) continue;
    const [x, , z] = r.pose;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(px(x), py(z), dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (names) label(ctx, m.name, px(x), py(z) - dotR - 7, Math.max(9, s * 0.38), C.cream, 700);
  }
}

/** Live layer of the large (fixed) map: bots, other shoppers, the player. */
function drawLive(ctx: CanvasRenderingContext2D, f: MapFrame, large: boolean, t: number) {
  const { px, py, s } = f;
  ctx.clearRect(0, 0, f.width, f.height);
  const dotR = Math.max(2.6, s * (large ? 0.32 : 0.45));
  drawOthers(ctx, f, dotR, large);

  const p = mapLive.player;
  if (!p.valid) return;
  const x = px(p.x);
  const y = py(p.z);
  const h = mapHeading(p.yaw);
  // View cone.
  const reach = Math.max(26, s * (large ? 6 : 7));
  const cone = ctx.createRadialGradient(x, y, 0, x, y, reach);
  cone.addColorStop(0, "rgba(247,196,22,0.45)");
  cone.addColorStop(1, "rgba(247,196,22,0)");
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, reach, h - 0.62, h + 0.62);
  ctx.closePath();
  ctx.fill();
  // Pulse ring.
  const pulse = (t % 1600) / 1600;
  ctx.strokeStyle = `rgba(247,196,22,${0.55 * (1 - pulse)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, dotR + pulse * dotR * 3, 0, Math.PI * 2);
  ctx.stroke();
  // Arrow.
  const a = Math.max(7, s * (large ? 0.75 : 1.0));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(h);
  ctx.beginPath();
  ctx.moveTo(a, 0);
  ctx.lineTo(-a * 0.7, a * 0.65);
  ctx.lineTo(-a * 0.35, 0);
  ctx.lineTo(-a * 0.7, -a * 0.65);
  ctx.closePath();
  ctx.fillStyle = C.player;
  ctx.shadowColor = "rgba(247,196,22,0.8)";
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#0d1311";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  if (large) label(ctx, "YOU", x, y + a + 10, Math.max(10, s * 0.45), C.amber, 800);
}

/** Static + live canvases at one size. */
function MapCanvas({ width, signs, large }: { width: number; signs: Sign[]; large: boolean }) {
  const frame = useMemo(() => mapFrame(width), [width]);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [staticRef.current, liveRef.current]) {
      if (!c) continue;
      c.width = Math.round(frame.width * dpr);
      c.height = Math.round(frame.height * dpr);
      c.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const sctx = staticRef.current?.getContext("2d");
    if (sctx) drawStatic(sctx, frame, signs, large);
    const lctx = liveRef.current?.getContext("2d");
    if (!lctx) return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 33) return; // ~30 fps is plenty for a map
      last = t;
      drawLive(lctx, frame, large, t);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frame, signs, large]);

  const style = { width: frame.width, height: frame.height };
  return (
    <div className="relative" style={style}>
      <canvas ref={staticRef} className="absolute inset-0" style={style} aria-hidden />
      <canvas ref={liveRef} className="absolute inset-0" style={style} aria-hidden />
    </div>
  );
}

// ───────────────────────────── compact heading-up map ─────────────────────────────

/** Where the shopper is, in words (shown under the compact map). */
function zoneName(x: number, z: number, aisles: { text: string; x: number; z: number }[]): string {
  const near = (ax: number, az: number, r: number) => Math.hypot(x - ax, z - az) < r;
  for (const u of SHOP_UNITS) {
    const w = (u.wall === "hall" ? HALL_WALL : SIDE_WALL)[u.side].inner;
    if (Math.abs(x - u.x) < SHOP_DOOR.width / 2 + 1.2 && Math.abs(z - w) < 3.2) return `${u.label} · for rent`;
  }
  if (near(LUCKY_WHEEL.x, LUCKY_WHEEL.z, 4.5)) return "Lucky wheel";
  if (near(SUPPORTERS_STAND.x, SUPPORTERS_STAND.z, 3.5)) return "Supporters wall";
  const co = STORE_ENV.checkout;
  if (co && near((co.min[0] + co.max[0]) / 2, (co.min[2] + co.max[2]) / 2, 3)) return "Checkout";
  if (near((ENTRANCE.x0 + ENTRANCE.x1) / 2, ENTRANCE.z, 3.5)) return "Entrance";
  if (x > GATE_X - 3.5) return "Coming soon · closed";
  if (x > OLD_END_X) return "New hall";
  const a = aisles.find((l) => Math.abs(z - l.z) < 1.5 && Math.abs(x - l.x) < 3.6);
  if (a) return a.text.length > 28 ? `${a.text.slice(0, 27)}…` : a.text;
  return "Main store";
}

/** Round, heading-up minimap: the shopper stays in the middle pointing up; the store turns and slides around them. */
function CompassMap({ size, signs, onZone }: { size: number; signs: Sign[]; onZone: (zone: string) => void }) {
  const frame = useMemo(() => mapFrame((size / 30) * MAP_W), [size]); // ~30 m across the dial
  const ref = useRef<HTMLCanvasElement>(null);
  const aisles = useMemo(() => aisleLabels(signs), [signs]);

  useEffect(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Static layer (whole store), drawn once.
    const st = document.createElement("canvas");
    st.width = Math.round(frame.width * dpr);
    st.height = Math.round(frame.height * dpr);
    const sctx = st.getContext("2d");
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!sctx || !c || !ctx) return;
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStatic(sctx, frame, signs, false);
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);

    const { px, py, s } = frame;
    const R = size / 2;
    const cx = R;
    const cy = R + size * 0.1; // a little below the centre: more of what's ahead
    let raf = 0;
    let last = 0;
    let lastZone = "";
    let zoneAt = 0;

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 33) return; // ~30 fps
      last = t;
      const p = mapLive.player;
      const rot = headingUpRotation(p.valid ? mapHeading(p.yaw) : -Math.PI / 2);
      const ox = p.valid ? px(p.x) : frame.width / 2;
      const oy = p.valid ? py(p.z) : frame.height / 2;
      const toScreen = (x: number, z: number) => {
        const dx = px(x) - ox;
        const dy = py(z) - oy;
        return [cx + dx * Math.cos(rot) - dy * Math.sin(rot), cy + dx * Math.sin(rot) + dy * Math.cos(rot)] as const;
      };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, R - 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#0b100e";
      ctx.fillRect(0, 0, size, size);

      // The store, turned so the shopper looks up.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.translate(-ox, -oy);
      ctx.drawImage(st, 0, 0, frame.width, frame.height);
      drawOthers(ctx, frame, Math.max(3.2, s * 0.42), false);
      ctx.restore();

      // Upright labels.
      const fs = Math.max(10, size * 0.05);
      const put = (text: string, x: number, z: number, color: string) => {
        const [sx, sy] = toScreen(x, z);
        if (Math.hypot(sx - R, sy - R) < R - fs * 1.4) label(ctx, text, sx, sy, fs, color, 800);
      };
      for (const u of SHOP_UNITS) {
        const w = (u.wall === "hall" ? HALL_WALL : SIDE_WALL)[u.side].inner;
        put(u.label, u.x, w + (u.side === "N" ? 1.4 : -1.4), C.amber);
      }
      put("COMING SOON", (GATE_X + NEW_END_X) / 2, 0.7, C.amber);
      put("ENTRANCE", (ENTRANCE.x0 + ENTRANCE.x1) / 2, ENTRANCE.z - 1.3, "#7fe0a8");
      if (STORE_ENV.checkout) put("CHECKOUT", -10.9, 6.4, "#7fe0a8");
      put("LUCKY WHEEL", LUCKY_WHEEL.x, LUCKY_WHEEL.z - 2.3, C.amber);

      // View cone + the shopper's arrow (always pointing up).
      const reach = size * 0.38;
      const cone = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
      cone.addColorStop(0, "rgba(247,196,22,0.55)");
      cone.addColorStop(1, "rgba(247,196,22,0)");
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, reach, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
      ctx.closePath();
      ctx.fill();
      const pulse = (t % 1600) / 1600;
      ctx.strokeStyle = `rgba(247,196,22,${0.6 * (1 - pulse)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 7 + pulse * 16, 0, Math.PI * 2);
      ctx.stroke();
      const a = Math.max(11, size * 0.06);
      ctx.beginPath();
      ctx.moveTo(cx, cy - a);
      ctx.lineTo(cx + a * 0.72, cy + a * 0.78);
      ctx.lineTo(cx, cy + a * 0.36);
      ctx.lineTo(cx - a * 0.72, cy + a * 0.78);
      ctx.closePath();
      ctx.fillStyle = C.player;
      ctx.shadowColor = "rgba(247,196,22,0.9)";
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#0d1311";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Bezel: gold ring + ticks, and "N" (the top of the large map) turning with the store.
      ctx.strokeStyle = "rgba(247,196,22,0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(R, R, R - 2.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(243,237,224,0.35)";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 24; i++) {
        const ang = (i / 24) * Math.PI * 2 + rot;
        const r0 = R - (i % 6 === 0 ? 11 : 7);
        ctx.beginPath();
        ctx.moveTo(R + Math.cos(ang) * r0, R + Math.sin(ang) * r0);
        ctx.lineTo(R + Math.cos(ang) * (R - 4), R + Math.sin(ang) * (R - 4));
        ctx.stroke();
      }
      const na = -Math.PI / 2 + rot;
      const nx = R + Math.cos(na) * (R - 14);
      const ny = R + Math.sin(na) * (R - 14);
      ctx.fillStyle = C.red;
      ctx.beginPath();
      ctx.arc(nx, ny, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `800 11px ${FONT}`;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("N", nx, ny + 0.5);

      if (p.valid && t - zoneAt > 250) {
        zoneAt = t;
        const zone = zoneName(p.x, p.z, aisles);
        if (zone !== lastZone) {
          lastZone = zone;
          onZone(zone);
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frame, size, signs, aisles, onZone]);

  return <canvas ref={ref} style={{ width: size, height: size }} className="block rounded-full" aria-hidden />;
}

function Legend() {
  const item = (swatch: React.ReactNode, text: string) => (
    <span className="flex items-center gap-1.5">
      {swatch}
      {text}
    </span>
  );
  const box = (bg: string) => <span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: bg }} />;
  const dot = (bg: string, ring = "transparent") => <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: bg, boxShadow: `0 0 0 1.5px ${ring}` }} />;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-cream/80">
      {item(<span className="text-amber">▲</span>, "You")}
      {item(dot("#4fb3ff", "#ffffff"), "Other shoppers")}
      {item(dot("#ff7eb6"), "Demo bots")}
      {item(box(C.gondola), "Aisles")}
      {item(box("rgba(47,143,91,0.85)"), "Checkout / entrance")}
      {item(box(C.amber), "Shops for rent")}
      {item(box("rgba(214,162,62,0.95)"), "Lucky wheel")}
      {item(box("rgba(247,196,22,0.35)"), "Coming soon")}
    </div>
  );
}

/** HUD minimap: compact while playing, large overlay on N / tap. */
export function MiniMap({ signs }: { signs: Sign[] }) {
  const locked = useStoreUi((s) => s.locked);
  const inspect = useStoreUi((s) => s.inspect);
  const touchMode = useStoreUi((s) => s.touchMode);
  const overlayOpen = useStoreUi((s) => !!s.openProductId);
  const [large, setLarge] = useState(false);
  const [vw, setVw] = useState(1280);
  const [zone, setZone] = useState("Main store");

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggle = useCallback(() => setLarge((v) => !v), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (e.code !== "KeyN" || e.repeat || (t instanceof Element && t.closest("input, textarea, select"))) return;
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  if (!(locked || inspect) || overlayOpen) return null;

  const small = Math.round(Math.min(touchMode ? 140 : 236, vw * (touchMode ? 0.3 : 0.24)));
  const big = Math.round(Math.min(1180, vw * 0.9));

  return (
    <>
      <div
        className={`fixed z-20 flex select-none flex-col items-center gap-2 ${touchMode ? "pointer-events-auto" : "pointer-events-none"}`}
        style={{ [touchMode ? "left" : "right"]: `calc(env(safe-area-inset-${touchMode ? "left" : "right"}, 0px) + 1rem)`, top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
        onClick={toggle}
        role="img"
        aria-label={`Store map, turning with you. You are at: ${zone}`}
      >
        <div className="rounded-full p-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.55)] ring-1 ring-black/40" style={{ background: "radial-gradient(circle at 30% 25%, #3a3424, #0d1311 70%)" }}>
          <CompassMap size={small} signs={signs} onZone={setZone} />
        </div>
        <div className="flex max-w-[16rem] items-center gap-2 rounded-full bg-ink/85 px-3.5 py-1.5 text-cream shadow-lg ring-1 ring-amber/40 backdrop-blur">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber" />
          <span className="truncate text-xs font-semibold tracking-wide">{zone}</span>
          {!touchMode && <kbd className="ml-1 shrink-0 rounded bg-cream/15 px-1.5 py-0.5 font-mono text-[10px] text-cream/90">N</kbd>}
        </div>
      </div>

      {large && (
        <div className={`fixed inset-0 z-40 flex items-center justify-center bg-ink/45 p-4 ${touchMode ? "pointer-events-auto" : "pointer-events-none"}`} onClick={toggle}>
          <div className="rounded-3xl p-5 shadow-2xl ring-1 ring-cream/15 backdrop-blur-md" style={{ background: "rgba(13,19,17,0.9)" }}>
            <div className="mb-3 flex items-baseline justify-between gap-6">
              <h2 className="font-display text-xl text-cream">
                WEGO SHIIIP <span className="text-amber">· Store map</span>
              </h2>
              <p className="text-xs text-cream/60">{touchMode ? "Tap to close" : "Press N to close"} · Seen from above · N on the small map = top of this map</p>
            </div>
            <div className="overflow-hidden rounded-2xl ring-1 ring-cream/10">
              <MapCanvas width={big} signs={signs} large />
            </div>
            <Legend />
          </div>
        </div>
      )}
    </>
  );
}

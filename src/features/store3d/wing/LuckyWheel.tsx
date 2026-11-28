"use client";

/**
 * Big carnival "lucky wheel" in the new hall (place: LUCKY_WHEEL in ../env/extension.ts): polished gold rim with
 * chasing marquee bulbs, red/cream lacquered segments carrying the supporters' names (store_settings
 * `storefront.supporters`, edited by super admins in /admin/supporters), gold pegs, domed gold hub, red pointer pin
 * with a flapping tip, and a gold tripod stand. Aim at it and press E (or tap the action button) to spin.
 * The spin is just for fun, in the visitor's own browser: no prize, nothing stored.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import type { SupportersWall } from "@/lib/storefront/supporters";
import { LUCKY_WHEEL } from "../env/extension";
import { useInteractable } from "../interactables";
import { playWheelTick, playWheelWin } from "../sfx";
import { useStoreUi, type InteractionTarget } from "../ui-store";
import { supportersDevDemo } from "./SupportersBoard";
import { WheelPrizes } from "./WheelPrizes";
import { easeOutQuart, EMPTY_WHEEL_SEGMENTS, mod, onSpinRequest, WHEEL_SPIN_ENABLED, segmentAtPointer, spinTarget, wheelNames } from "./lucky-wheel";

const R = 1.35; // painted disc radius (m)
const CY = 2.12; // wheel centre above the floor
const RIM_R = R + 0.15; // centre line of the gold rim
const BULBS = 32;
const RED = "#c3102b";
const RED_DEEP = "#8e0a1e";
const CREAM = "#f8f3e9";
const GOLD = "#e8b04a";
const GOLD_LINE = "#caa04a";
const TAU = Math.PI * 2;
const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif';

const BULB_ON = new THREE.Color(1, 0.86, 0.52);
const BULB_OFF = new THREE.Color(0.42, 0.3, 0.14);

function randomUnit(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! / 2 ** 32;
}

/** The painted face: wedges, gold dividers, names along the radius, a soft lacquer shading. */
function drawFace(ctx: CanvasRenderingContext2D, names: string[]) {
  const size = ctx.canvas.width;
  const c = size / 2;
  const r = c - 2;
  const count = names.length || EMPTY_WHEEL_SEGMENTS;
  const seg = TAU / count;
  ctx.clearRect(0, 0, size, size);

  for (let i = 0; i < count; i++) {
    const odd = count % 2 === 1 && i === count - 1;
    ctx.beginPath();
    ctx.moveTo(c, c);
    // Canvas y points down: disc angle φ (CCW) is canvas angle −φ.
    ctx.arc(c, c, r, -(i + 1) * seg, -i * seg);
    ctx.closePath();
    ctx.fillStyle = odd ? "#e9b949" : i % 2 === 0 ? RED : CREAM;
    ctx.fill();
  }

  // Lacquer shading: a little darker toward the rim, a soft highlight upper-left.
  const shade = ctx.createRadialGradient(c, c, r * 0.15, c, c, r);
  shade.addColorStop(0, "rgba(255,255,255,0.10)");
  shade.addColorStop(0.7, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(40,0,0,0.22)");
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, TAU);
  ctx.fill();

  // Gold dividers.
  ctx.strokeStyle = GOLD_LINE;
  ctx.lineWidth = Math.max(2, size * (count > 60 ? 0.0018 : 0.003));
  for (let i = 0; i < count; i++) {
    const a = -i * seg;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r * 0.16, c + Math.sin(a) * r * 0.16);
    ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.lineWidth = size * 0.006;
  ctx.beginPath();
  ctx.arc(c, c, r - ctx.lineWidth / 2, 0, TAU);
  ctx.stroke();

  // Names: from near the rim toward the hub, centred in their wedge.
  const outer = r * 0.86;
  const inner = r * 0.21;
  const maxLen = outer - inner;
  for (let i = 0; i < count; i++) {
    const label = names[i] ?? "★";
    const odd = count % 2 === 1 && i === count - 1;
    const mid = (i + 0.5) * seg;
    const chord = 2 * Math.sin(seg / 2) * r * 0.62; // wedge width where the text sits
    let fs = Math.min(chord * 0.62, r * 0.11);
    ctx.font = `800 ${fs}px ${FONT}`;
    let w = ctx.measureText(label).width;
    if (w > maxLen) {
      fs = Math.max(size * 0.0075, (fs * maxLen * 0.97) / w);
      ctx.font = `800 ${fs}px ${FONT}`;
      w = ctx.measureText(label).width;
    }
    let text = label;
    if (w > maxLen) {
      while (text.length > 1 && ctx.measureText(`${text}…`).width > maxLen) text = text.slice(0, -1);
      text = `${text}…`;
    }
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-mid);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = odd ? "#5a1208" : i % 2 === 0 ? "#fffaf0" : RED_DEEP;
    ctx.shadowColor = i % 2 === 0 ? "rgba(60,0,0,0.45)" : "rgba(255,255,255,0.6)";
    ctx.shadowBlur = fs * 0.08;
    ctx.shadowOffsetY = fs * 0.04;
    ctx.fillText(text, outer, 0);
    ctx.restore();
  }
}

/** Teardrop pointer pin (lathe), tip pointing down (−y) from the pivot at the origin. */
function pinGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const top = 0.13;
  for (let k = 0; k <= 12; k++) {
    const a = (k / 12) * (Math.PI / 2 + 0.35); // round head
    pts.push(new THREE.Vector2(Math.sin(a) * top, Math.cos(a) * top));
  }
  const yJoin = Math.cos(Math.PI / 2 + 0.35) * top;
  const rJoin = Math.sin(Math.PI / 2 + 0.35) * top;
  for (let k = 1; k <= 10; k++) {
    const t = k / 10;
    pts.push(new THREE.Vector2(rJoin * (1 - t) * (1 - t * 0.15) + 0.004 * t, yJoin - t * 0.36));
  }
  pts.push(new THREE.Vector2(0, yJoin - 0.365));
  const g = new THREE.LatheGeometry(pts.reverse(), 32);
  g.scale(1, 1, 0.42);
  return g;
}

/** A gold tube between two points. */
function Tube({ a, b, r, material }: { a: THREE.Vector3Tuple; b: THREE.Vector3Tuple; r: number; material: THREE.Material }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    return {
      pos: va.clone().add(vb).multiplyScalar(0.5),
      quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()),
      len: dir.length(),
    };
  }, [a, b]);
  return (
    <mesh position={pos} quaternion={quat} material={material} castShadow>
      <cylinderGeometry args={[r, r, len, 16]} />
    </mesh>
  );
}

const lerp3 = (a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, t: number): THREE.Vector3Tuple => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function LuckyWheel({ wall, lowPower }: { wall?: SupportersWall; lowPower: boolean }) {
  const names = useMemo(() => wheelNames(((supportersDevDemo() ?? wall)?.people ?? []).map((p) => p.name)), [wall]);
  const count = names.length || EMPTY_WHEEL_SEGMENTS;
  const [winner, setWinner] = useState<string | null>(null);

  const root = useRef<THREE.Group>(null);
  const disc = useRef<THREE.Group>(null);
  const flap = useRef<THREE.Group>(null);
  const bulbs = useRef<THREE.InstancedMesh>(null);
  const spin = useRef({ rot: 0, from: 0, to: 0, t0: 0, dur: 1, spinning: false, seg: -1, flap: 0, flapVel: 0, step: -1, winAt: -Infinity, near: 0 });

  const target = useMemo<InteractionTarget>(() => ({ key: "lucky-wheel", kind: "wheel", label: "Lucky wheel" }), []);
  // While the wheel is "coming soon" it is only a blocker for the crosshair (no spin hint, E does nothing).
  useInteractable(root, WHEEL_SPIN_ENABLED ? target : null);

  const mats = useMemo(
    () => ({
      gold: new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.26, envMapIntensity: 1.6, emissive: "#5a3a0c", emissiveIntensity: 0.45 }),
      goldSatin: new THREE.MeshStandardMaterial({ color: "#d09a3e", metalness: 1, roughness: 0.36, envMapIntensity: 1.4, emissive: "#4a300a", emissiveIntensity: 0.4 }),
      red: new THREE.MeshStandardMaterial({ color: "#d4142f", metalness: 0.15, roughness: 0.22, envMapIntensity: 1.2 }),
      back: new THREE.MeshStandardMaterial({ color: "#5c0a14", metalness: 0.2, roughness: 0.5 }),
      bulb: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
    }),
    [],
  );
  const pin = useMemo(() => pinGeometry(), []);

  // Painted face, redrawn only when the names change (a new texture each time; the old one is disposed).
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = lowPower ? 1024 : 2048;
    drawFace(c.getContext("2d")!, names);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [lowPower, names]);
  useEffect(() => () => tex.dispose(), [tex]);
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      pin.dispose();
    },
    [mats, pin],
  );

  // Peg positions (rotate with the disc): one at each divider near the rim.
  const pegs = useMemo(() => {
    const n = Math.min(count, 60);
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * TAU;
      return [Math.cos(a) * R * 0.94, Math.sin(a) * R * 0.94] as const;
    });
  }, [count]);
  const pegMesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = pegMesh.current;
    if (!m) return;
    const o = new THREE.Object3D();
    pegs.forEach(([x, y], i) => {
      o.position.set(x, y, 0.025);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.count = pegs.length;
    m.instanceMatrix.needsUpdate = true;
  }, [pegs]);

  useEffect(() => {
    const m = bulbs.current;
    if (!m) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < BULBS; i++) {
      const a = (i / BULBS) * TAU + Math.PI / 2;
      o.position.set(Math.cos(a) * RIM_R, Math.sin(a) * RIM_R, 0.1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, BULB_OFF);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);

  // Spin requests (E key / touch button while aiming at the wheel).
  useEffect(
    () =>
      onSpinRequest(() => {
        const s = spin.current;
        if (s.spinning || !WHEEL_SPIN_ENABLED) return;
        if (!names.length) {
          useStoreUi.getState().showToast("Names are coming soon — check back!");
          return;
        }
        const win = Math.min(names.length - 1, Math.floor(randomUnit() * names.length));
        s.from = s.rot;
        s.to = spinTarget(s.rot, win, names.length, 4 + Math.floor(randomUnit() * 3), randomUnit() - 0.5);
        s.dur = 6 + randomUnit() * 1.5;
        s.t0 = performance.now() / 1000;
        s.spinning = true;
        setWinner(null);
      }),
    [names],
  );

  useFrame(({ camera }, dt) => {
    const s = spin.current;
    const now = performance.now() / 1000;
    const step = Math.min(dt, 0.05);
    s.near = Math.hypot(camera.position.x - LUCKY_WHEEL.x, camera.position.z - LUCKY_WHEEL.z);

    if (s.spinning) {
      const t = (now - s.t0) / s.dur;
      s.rot = s.from + (s.to - s.from) * easeOutQuart(t);
      const segNow = segmentAtPointer(s.rot, count);
      if (segNow !== s.seg) {
        if (s.seg !== -1) {
          s.flapVel -= 9; // the pin's tip is knocked to the side by a peg
          if (s.near < 16) playWheelTick(Math.max(0.15, 1 - s.near / 16));
        }
        s.seg = segNow;
      }
      if (t >= 1) {
        s.rot = mod(s.to, TAU);
        s.spinning = false;
        s.winAt = now;
        const name = names[segmentAtPointer(s.rot, count)] ?? "";
        setWinner(name);
        if (s.near < 16) playWheelWin();
        if (s.near < 9) useStoreUi.getState().showToast(`${name}!`);
      }
    } else {
      s.seg = segmentAtPointer(s.rot, count);
    }
    if (disc.current) disc.current.rotation.z = s.rot;

    // Pin flap: damped spring back to rest.
    s.flapVel += (-160 * s.flap - 11 * s.flapVel) * step;
    s.flap = Math.max(-0.45, Math.min(0.45, s.flap + s.flapVel * step));
    if (flap.current) flap.current.rotation.z = s.flap;

    // Marquee bulbs: chase (faster while spinning), all blink after a win.
    const m = bulbs.current;
    if (m && m.instanceColor) {
      const celebrating = now - s.winAt < 3;
      const rate = celebrating ? 4 : s.spinning ? 16 : 6;
      const k = Math.floor(now * rate);
      if (k !== s.step) {
        s.step = k;
        for (let i = 0; i < BULBS; i++) {
          const on = celebrating ? k % 2 === 0 : (i + k) % 3 !== 0;
          m.setColorAt(i, on ? BULB_ON : BULB_OFF);
        }
        m.instanceColor.needsUpdate = true;
      }
    }
  });

  // Stand (local: +z = front of the wheel).
  const yBottom = CY - R - 0.2;
  const legL: [THREE.Vector3Tuple, THREE.Vector3Tuple] = [[-0.16, yBottom, -0.12], [-0.78, 0.04, 0.12]];
  const legR: [THREE.Vector3Tuple, THREE.Vector3Tuple] = [[0.16, yBottom, -0.12], [0.78, 0.04, 0.12]];
  const barY = 0.3;
  const tBar = (yBottom - barY) / (yBottom - 0.04);
  const title = winner ?? "LUCKY WHEEL";

  return (
    <group position={[LUCKY_WHEEL.x, 0, LUCKY_WHEEL.z]} rotation-y={LUCKY_WHEEL.yaw}>
      <group ref={root}>
        {/* ── stand ── */}
        <Tube a={legL[0]} b={legL[1]} r={0.04} material={mats.gold} />
        <Tube a={legR[0]} b={legR[1]} r={0.04} material={mats.gold} />
        <Tube a={[0, yBottom, -0.16]} b={[0, 0.04, -0.62]} r={0.04} material={mats.gold} />
        <Tube a={lerp3(legL[0], legL[1], tBar)} b={lerp3(legR[0], legR[1], tBar)} r={0.026} material={mats.gold} />
        <Tube a={[0, barY, lerp3(legL[0], legL[1], tBar)[2]]} b={lerp3([0, yBottom, -0.16], [0, 0.04, -0.62], tBar)} r={0.022} material={mats.gold} />
        <Tube a={[0, yBottom + 0.05, -0.14]} b={[0, CY, -0.14]} r={0.045} material={mats.goldSatin} />
        <Tube a={[0, CY, -0.3]} b={[0, CY, 0.02]} r={0.07} material={mats.goldSatin} />
        {[legL[1], legR[1], [0, 0.04, -0.62] as THREE.Vector3Tuple].map((p, i) => (
          <mesh key={i} position={[p[0], 0.018, p[2]]} material={mats.gold} castShadow>
            <cylinderGeometry args={[0.1, 0.12, 0.036, 24]} />
          </mesh>
        ))}
        <mesh position={[0, yBottom, -0.13]} material={mats.gold} castShadow>
          <sphereGeometry args={[0.085, 24, 16]} />
        </mesh>
        <mesh position={[0, barY, lerp3(legL[0], legL[1], tBar)[2]]} material={mats.gold}>
          <sphereGeometry args={[0.05, 16, 12]} />
        </mesh>

        <group position={[0, CY, 0]}>
          {/* ── spinning disc ── */}
          <group ref={disc}>
            <mesh position={[0, 0, -0.045]} rotation-x={Math.PI / 2} material={mats.back} castShadow>
              <cylinderGeometry args={[R + 0.04, R + 0.04, 0.08, 96]} />
            </mesh>
            <mesh position={[0, 0, 0.0]}>
              <circleGeometry args={[R, 128]} />
              <meshStandardMaterial map={tex} roughness={0.3} metalness={0.05} envMapIntensity={0.9} />
            </mesh>
            <instancedMesh ref={pegMesh} args={[undefined, undefined, 60]} material={mats.gold} castShadow>
              <sphereGeometry args={[0.028, 14, 10]} />
            </instancedMesh>
          </group>

          {/* ── rim: polished gold band with marquee bulbs ── */}
          <mesh scale={[1, 1, 0.55]} material={mats.gold} castShadow>
            <torusGeometry args={[RIM_R, 0.16, 24, 160]} />
          </mesh>
          <mesh position={[0, 0, 0.02]} material={mats.goldSatin}>
            <torusGeometry args={[R + 0.005, 0.022, 12, 160]} />
          </mesh>
          <mesh position={[0, 0, 0]} material={mats.goldSatin}>
            <torusGeometry args={[RIM_R + 0.155, 0.02, 12, 160]} />
          </mesh>
          <instancedMesh ref={bulbs} args={[undefined, undefined, BULBS]} material={mats.bulb}>
            <sphereGeometry args={[0.047, 16, 12]} />
            {/* Present from the first render, so the material is compiled with per-bulb colours. */}
            <instancedBufferAttribute attach="instanceColor" args={[new Float32Array(BULBS * 3).fill(0.4), 3]} />
          </instancedMesh>
          {/* bulb sockets */}
          {Array.from({ length: BULBS }, (_, i) => {
            const a = (i / BULBS) * TAU + Math.PI / 2;
            return (
              <mesh key={i} position={[Math.cos(a) * RIM_R, Math.sin(a) * RIM_R, 0.075]} rotation-x={Math.PI / 2} material={mats.goldSatin}>
                <cylinderGeometry args={[0.062, 0.062, 0.02, 16]} />
              </mesh>
            );
          })}

          {/* ── hub (fixed) ── */}
          <mesh position={[0, 0, 0.04]} scale={[1, 1, 0.6]} material={mats.gold} castShadow>
            <sphereGeometry args={[0.22, 40, 24]} />
          </mesh>
          <mesh position={[0, 0, 0.035]} material={mats.goldSatin}>
            <torusGeometry args={[0.235, 0.04, 16, 64]} />
          </mesh>

          {/* ── pointer pin at the top ── */}
          <group position={[0, RIM_R + 0.26, 0.16]}>
            <group ref={flap}>
              <mesh geometry={pin} material={mats.red} castShadow />
            </group>
            <mesh rotation-x={Math.PI / 2} position={[0, 0, 0.06]} material={mats.gold}>
              <cylinderGeometry args={[0.035, 0.035, 0.03, 20]} />
            </mesh>
          </group>
          <Tube a={[0, RIM_R + 0.1, 0.02]} b={[0, RIM_R + 0.26, 0.14]} r={0.025} material={mats.gold} />

          {/* ── title / result ── */}
          <Text
            position={[0, RIM_R + 0.68, 0.05]}
            fontSize={winner ? 0.26 : 0.22}
            letterSpacing={winner ? 0.04 : 0.3}
            maxWidth={3.2}
            color={winner ? "#ffd65a" : "#f3e3b8"}
            outlineWidth={0.012}
            outlineColor="#5a3a08"
            anchorX="center"
            anchorY="middle"
            fontWeight={800}
          >
            {winner ? `★ ${title} ★` : title}
          </Text>
        </group>
        <Suspense fallback={null}>
          <WheelPrizes gold={mats.gold} />
        </Suspense>
        {!WHEEL_SPIN_ENABLED && <ComingSoonBarrier gold={mats.gold} />}
      </group>
      {!lowPower && <pointLight position={[0, CY + 0.6, 2.4]} intensity={5} distance={7} decay={1.6} color="#fff0d2" />}
    </group>
  );
}

const BLACK = "#0d1311";
const AMBER = "#f7c416";
const POST_Y = 0.9; // rope hook height

/** Gold stanchion: weighted base, post, ball top. */
function Stanchion({ x, z, gold }: { x: number; z: number; gold: THREE.Material }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.02, 0]} material={gold} castShadow>
        <cylinderGeometry args={[0.11, 0.14, 0.04, 24]} />
      </mesh>
      <mesh position={[0, POST_Y / 2, 0]} material={gold} castShadow>
        <cylinderGeometry args={[0.028, 0.028, POST_Y, 16]} />
      </mesh>
      <mesh position={[0, POST_Y + 0.04, 0]} material={gold}>
        <sphereGeometry args={[0.05, 16, 12]} />
      </mesh>
    </group>
  );
}

/** Red velvet rope sagging between two stanchion tops. */
function Rope({ a, b, material }: { a: [number, number]; b: [number, number]; material: THREE.Material }) {
  const geo = useMemo(() => {
    const y = POST_Y - 0.03;
    const p0 = new THREE.Vector3(a[0], y, a[1]);
    const p2 = new THREE.Vector3(b[0], y, b[1]);
    const p1 = p0.clone().add(p2).multiplyScalar(0.5).setY(y - 0.22);
    return new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, p1, p2), 24, 0.022, 10, false);
  }, [a, b]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={material} castShadow />;
}

/**
 * Wheel not open yet: a black + amber "COMING SOON" sign (same look as the chained wing) in front of it and a red
 * velvet rope around it, low enough that the whole wheel stays in view. The walk-blocking box covers it all.
 */
function ComingSoonBarrier({ gold }: { gold: THREE.Material }) {
  const velvet = useMemo(() => new THREE.MeshStandardMaterial({ color: "#9a0c22", roughness: 0.85, metalness: 0 }), []);
  useEffect(() => () => velvet.dispose(), [velvet]);
  const zf = 1.2; // rope line in front of the wheel
  const zb = 0.25; // where the side ropes end, beside the wheel
  const posts: [number, number][] = [[-1.45, zb], [-1.45, zf], [-0.52, zf], [0.52, zf], [1.45, zf], [1.45, zb]];
  const SW = 0.92; // sign width (narrow + low: the prizes beside it and the wheel above stay in view)
  const SH = 0.32;
  const SY = 0.5; // sign centre height
  return (
    <group>
      {posts.map(([x, z], i) => (
        <Stanchion key={i} x={x} z={z} gold={gold} />
      ))}
      <Rope a={posts[0]!} b={posts[1]!} material={velvet} />
      <Rope a={posts[1]!} b={posts[2]!} material={velvet} />
      <Rope a={posts[3]!} b={posts[4]!} material={velvet} />
      <Rope a={posts[4]!} b={posts[5]!} material={velvet} />

      {/* sign on two legs, between the inner posts */}
      <group position={[0, 0, zf + 0.02]} rotation-x={-0.08}>
        {[-1, 1].map((side) => (
          <group key={side}>
            <mesh position={[side * (SW / 2 - 0.18), (SY - SH / 2) / 2, 0]} castShadow>
              <boxGeometry args={[0.04, SY - SH / 2, 0.04]} />
              <meshStandardMaterial color={BLACK} roughness={0.5} metalness={0.4} />
            </mesh>
            <mesh position={[side * (SW / 2 - 0.18), 0.015, 0]}>
              <boxGeometry args={[0.1, 0.03, 0.32]} />
              <meshStandardMaterial color={BLACK} roughness={0.5} metalness={0.4} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, SY, -0.012]} castShadow>
          <boxGeometry args={[SW + 0.05, SH + 0.05, 0.03]} />
          <meshStandardMaterial color={AMBER} roughness={0.4} metalness={0.2} />
        </mesh>
        <mesh position={[0, SY, 0.005]}>
          <planeGeometry args={[SW, SH]} />
          <meshStandardMaterial color={BLACK} roughness={0.6} />
        </mesh>
        <Text position={[0, SY + 0.04, 0.01]} fontSize={0.105} letterSpacing={0.06} color={AMBER} anchorX="center" anchorY="middle" fontWeight={800}>
          COMING SOON
        </Text>
        <Text position={[0, SY - 0.09, 0.01]} fontSize={0.034} letterSpacing={0.2} color="#f3ede0" anchorX="center" anchorY="middle">
          WIN THESE PRIZES · STAY TUNED
        </Text>
      </group>
    </group>
  );
}

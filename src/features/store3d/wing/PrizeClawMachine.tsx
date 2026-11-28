"use client";

/**
 * Playable prize claw cabinet on the Grand Plaza (place: PLAZA_PROPS.claw in ../env/extension.ts).
 * Lacquered cabinet with brushed-steel trim, four framed glass panes, LED-lit marquee, a two-axis gantry and an
 * articulated three-finger claw over a bed of plush bears and gacha capsules.
 *
 * Aim at it and press E (or tap the action button): 1st press starts the left↔right sweep, 2nd locks X and starts
 * front↔back, 3rd drops the claw. Game logic lives in ./claw-machine (pure, unit-tested). Just for fun: free,
 * nothing real is won, nothing stored.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Text } from "@react-three/drei";
import { PLAZA_PROPS } from "../env/extension";
import { useInteractable } from "../interactables";
import { playDrop, playWheelTick, playWheelWin } from "../sfx";
import { useStoreUi, type InteractionTarget } from "../ui-store";
import { AIM_TIMEOUT, CHUTE, CLAW_LIMIT_X, CLAW_LIMIT_Z, easeInOut, gripChance, nearestPrize, onClawPress, sweep, useClawGame, type ClawPhase } from "./claw-machine";

const W = 1.4; // cabinet width (x)
const D = 1.3; // cabinet depth (z)
const BASE_H = 0.98;
const DECK_Y = 1.0; // prize bed
const GLASS_TOP = 2.1;
const RAIL_Y = 2.03;
const REST_Y = 1.84; // claw hub hanging height at rest
const LOW_Y = 1.33; // claw hub at the bottom of a drop
const HOLD_DROP = 0.21; // held prize centre below the hub

type PrizeKind = "bear" | "capsule";
interface PrizeDef {
  kind: PrizeKind;
  name: string;
  color: string;
  accent: string;
  x: number;
  z: number;
  yaw: number;
  tilt: number;
}

const PRIZES: PrizeDef[] = [
  { kind: "bear", name: "honey teddy bear", color: "#b07a45", accent: "#e8cfa8", x: -0.42, z: -0.3, yaw: 0.4, tilt: 0.12 },
  { kind: "bear", name: "blush pink bear", color: "#e9a2b4", accent: "#fbe3ea", x: -0.1, z: -0.34, yaw: -0.3, tilt: -0.1 },
  { kind: "bear", name: "sky blue bear", color: "#8fb8d8", accent: "#e4eff8", x: 0.24, z: -0.28, yaw: -0.8, tilt: 0.08 },
  { kind: "bear", name: "cream polar bear", color: "#efe6d6", accent: "#ffffff", x: -0.3, z: 0.06, yaw: 2.6, tilt: 0.16 },
  { kind: "bear", name: "chocolate bear", color: "#6b4630", accent: "#c79c76", x: 0.06, z: 0.02, yaw: 0.1, tilt: -0.14 },
  { kind: "bear", name: "mint bear", color: "#9fd8c4", accent: "#eaf8f2", x: -0.36, z: 0.36, yaw: 0.9, tilt: 0.05 },
  { kind: "capsule", name: "golden mystery capsule", color: "#f2b632", accent: "#ffffff", x: -0.48, z: -0.04, yaw: 0, tilt: 0.5 },
  { kind: "capsule", name: "red mystery capsule", color: "#d6283d", accent: "#ffffff", x: 0.3, z: 0.02, yaw: 0, tilt: -0.4 },
  { kind: "capsule", name: "violet mystery capsule", color: "#7c4bd6", accent: "#ffffff", x: -0.05, z: 0.32, yaw: 0, tilt: 0.9 },
  { kind: "capsule", name: "teal mystery capsule", color: "#169c8c", accent: "#ffffff", x: 0.1, z: -0.12, yaw: 0, tilt: 0.3 },
  { kind: "capsule", name: "blue mystery capsule", color: "#2b6fd6", accent: "#ffffff", x: 0.1, z: 0.36, yaw: 0, tilt: -0.7 },
];

type PrizeState = "rest" | "held" | "fall" | "gone";
interface PrizeRt {
  x: number;
  y: number;
  z: number;
  vy: number;
  state: PrizeState;
  respawnAt: number;
  scale: number;
}

function randomUnit(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! / 2 ** 32;
}

function useClawMaterials() {
  const m = useMemo(
    () => ({
      lacquer: new THREE.MeshPhysicalMaterial({ color: "#9e1020", roughness: 0.28, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 }),
      lacquerDark: new THREE.MeshPhysicalMaterial({ color: "#5e0912", roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
      steel: new THREE.MeshStandardMaterial({ color: "#c9ced4", metalness: 0.9, roughness: 0.28 }),
      chrome: new THREE.MeshStandardMaterial({ color: "#eef1f4", metalness: 1, roughness: 0.1 }),
      alu: new THREE.MeshStandardMaterial({ color: "#1b1e22", metalness: 0.7, roughness: 0.38 }),
      rubber: new THREE.MeshStandardMaterial({ color: "#0e0f11", roughness: 0.9 }),
      deck: new THREE.MeshStandardMaterial({ color: "#16181c", roughness: 0.6, metalness: 0.2 }),
      glass: new THREE.MeshPhysicalMaterial({ color: "#e8f4fa", metalness: 0, roughness: 0.04, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 }),
      acrylic: new THREE.MeshPhysicalMaterial({ color: "#dfeff7", roughness: 0.08, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
      smoked: new THREE.MeshStandardMaterial({ color: "#111418", roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.82 }),
      led: new THREE.MeshBasicMaterial({ color: "#fff4dc", toneMapped: false }),
      marquee: new THREE.MeshStandardMaterial({ color: "#2a0306", emissive: "#ff2d3d", emissiveIntensity: 0.35, roughness: 0.4 }),
      buttonGlow: new THREE.MeshStandardMaterial({ color: "#ffb21a", emissive: "#ff9a00", emissiveIntensity: 1.4, roughness: 0.25 }),
      knob: new THREE.MeshPhysicalMaterial({ color: "#c8101f", roughness: 0.18, clearcoat: 1 }),
      screen: new THREE.MeshBasicMaterial({ color: "#39f0b8", toneMapped: false }),
      black: new THREE.MeshStandardMaterial({ color: "#0b0b0c", roughness: 0.3 }),
      eye: new THREE.MeshPhysicalMaterial({ color: "#050505", roughness: 0.05, clearcoat: 1 }),
      capsuleTop: new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.05, transmission: 0, transparent: true, opacity: 0.45, depthWrite: false }),
    }),
    [],
  );
  useEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m]);
  return m;
}
type ClawMats = ReturnType<typeof useClawMaterials>;

/** Soft plush fabric (sheen) for a bear. */
function useFabric(color: string, accent: string) {
  const mats = useMemo(
    () => ({
      fur: new THREE.MeshPhysicalMaterial({ color, roughness: 0.95, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.4) }),
      pad: new THREE.MeshPhysicalMaterial({ color: accent, roughness: 0.95, sheen: 0.8, sheenRoughness: 0.7, sheenColor: new THREE.Color("#ffffff") }),
    }),
    [color, accent],
  );
  useEffect(() => () => Object.values(mats).forEach((x) => x.dispose()), [mats]);
  return mats;
}

/** Seated plush teddy bear, ~0.2 m tall, origin at its centre of mass. */
function PlushBear({ def, mats }: { def: PrizeDef; mats: ClawMats }) {
  const f = useFabric(def.color, def.accent);
  return (
    <group rotation={[def.tilt * 0.4, def.yaw, def.tilt]}>
      {/* body */}
      <mesh position={[0, -0.02, 0]} scale={[1, 1.1, 0.88]} material={f.fur} castShadow>
        <sphereGeometry args={[0.066, 20, 16]} />
      </mesh>
      <mesh position={[0, -0.02, 0.05]} scale={[1, 1.15, 0.5]} material={f.pad}>
        <sphereGeometry args={[0.042, 16, 12]} />
      </mesh>
      {/* head */}
      <group position={[0, 0.085, 0.006]}>
        <mesh scale={[1.06, 0.96, 0.95]} material={f.fur} castShadow>
          <sphereGeometry args={[0.058, 20, 16]} />
        </mesh>
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.046, 0.042, -0.006]}>
            <mesh scale={[1, 1, 0.6]} material={f.fur}>
              <sphereGeometry args={[0.022, 14, 10]} />
            </mesh>
            <mesh position={[0, 0, 0.008]} scale={[1, 1, 0.35]} material={f.pad}>
              <sphereGeometry args={[0.013, 12, 8]} />
            </mesh>
          </group>
        ))}
        {/* muzzle, nose, eyes */}
        <mesh position={[0, -0.016, 0.048]} scale={[1.15, 0.85, 0.75]} material={f.pad}>
          <sphereGeometry args={[0.024, 16, 12]} />
        </mesh>
        <mesh position={[0, -0.008, 0.066]} scale={[1.3, 0.85, 0.8]} material={mats.eye}>
          <sphereGeometry args={[0.0075, 10, 8]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.022, 0.014, 0.05]} material={mats.eye}>
            <sphereGeometry args={[0.0062, 10, 8]} />
          </mesh>
        ))}
      </group>
      {/* arms */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.064, -0.012, 0.022]} rotation={[0.7, 0, s * 0.5]} material={f.fur}>
          <capsuleGeometry args={[0.019, 0.04, 6, 12]} />
        </mesh>
      ))}
      {/* legs with foot pads, sitting forward */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.036, -0.068, 0.04]} rotation-x={Math.PI / 2 - 0.25}>
          <mesh material={f.fur}>
            <capsuleGeometry args={[0.022, 0.03, 6, 12]} />
          </mesh>
          <mesh position={[0, 0.034, 0]} rotation-x={-Math.PI / 2} scale={[1, 1, 0.3]} material={f.pad}>
            <sphereGeometry args={[0.018, 12, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Two-tone gacha capsule: clear tinted dome over a coloured cup, with a seam ring. */
function Capsule({ def, mats }: { def: PrizeDef; mats: ClawMats }) {
  const cup = useMemo(() => new THREE.MeshPhysicalMaterial({ color: def.color, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }), [def.color]);
  useEffect(() => () => cup.dispose(), [cup]);
  return (
    <group rotation={[def.tilt, 0, def.tilt * 0.6]}>
      <mesh material={cup} castShadow>
        <sphereGeometry args={[0.068, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
      </mesh>
      <mesh material={mats.capsuleTop}>
        <sphereGeometry args={[0.068, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {/* toy inside */}
      <mesh position={[0, 0.012, 0]} material={cup}>
        <icosahedronGeometry args={[0.03, 0]} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} material={mats.chrome}>
        <torusGeometry args={[0.068, 0.0045, 8, 32]} />
      </mesh>
    </group>
  );
}

/** One claw finger: steel link + hooked rubber-tipped tip. Rotates about z at the hub (open > 0). */
function Finger({ angle, mats, fingerRef }: { angle: number; mats: ClawMats; fingerRef: (g: THREE.Group | null) => void }) {
  return (
    <group rotation-y={angle}>
      <group position={[0.042, -0.035, 0]} ref={fingerRef}>
        <mesh position={[0.012, -0.055, 0]} rotation-z={0.22} material={mats.steel} castShadow>
          <boxGeometry args={[0.012, 0.11, 0.022]} />
        </mesh>
        <mesh position={[0.024, -0.108, 0]} rotation-x={Math.PI / 2} material={mats.chrome}>
          <cylinderGeometry args={[0.008, 0.008, 0.026, 10]} />
        </mesh>
        <mesh position={[0.012, -0.15, 0]} rotation-z={-0.45} material={mats.steel} castShadow>
          <boxGeometry args={[0.011, 0.085, 0.02]} />
        </mesh>
        <mesh position={[-0.006, -0.188, 0]} rotation-z={-1.0} material={mats.rubber}>
          <boxGeometry args={[0.014, 0.03, 0.024]} />
        </mesh>
      </group>
    </group>
  );
}

const FINGER_OPEN = 0.55;
const FINGER_CLOSED = -0.12;

export function PrizeClawMachine() {
  const { x, z } = PLAZA_PROPS.claw;
  const mats = useClawMaterials();
  const root = useRef<THREE.Group>(null);
  const bridge = useRef<THREE.Group>(null);
  const trolley = useRef<THREE.Group>(null);
  const clawHub = useRef<THREE.Group>(null);
  const cable = useRef<THREE.Mesh>(null);
  const fingers = useRef<(THREE.Group | null)[]>([]);
  const prizeGroups = useRef<(THREE.Group | null)[]>([]);
  const marqueeLeds = useRef<THREE.InstancedMesh>(null);
  const button = useRef<THREE.Mesh>(null);

  const prizes = useRef<PrizeRt[]>(PRIZES.map((p) => ({ x: p.x, y: DECK_Y + 0.075, z: p.z, vy: 0, state: "rest", respawnAt: 0, scale: 1 })));
  const game = useRef({
    phase: "idle" as ClawPhase,
    t0: 0,
    x: CHUTE.x as number,
    z: CHUTE.z as number,
    y: REST_Y,
    open: 0.3,
    from: { x: CHUTE.x as number, z: CHUTE.z as number },
    held: -1,
    willSlip: false,
    slipAt: 0,
    won: false,
    lastTick: 0,
    pressed: false,
  });

  const enterRef = useRef<(p: ClawPhase) => void>(() => {});
  const target = useMemo<InteractionTarget>(() => ({ key: "prize-claw", kind: "claw", label: "Prize claw" }), []);
  useInteractable(root, target);

  useEffect(() => {
    const setPhase = useClawGame.getState().setPhase;
    const enter = (p: ClawPhase) => {
      const g = game.current;
      g.phase = p;
      g.t0 = performance.now() / 1000;
      setPhase(p);
    };
    const off = onClawPress(() => {
      const g = game.current;
      if (g.phase === "idle") {
        g.from = { x: g.x, z: g.z };
        g.won = false;
        enter("aimX");
        playWheelTick(0.8);
      } else if (g.phase === "aimX") {
        g.from = { x: g.x, z: g.z };
        enter("aimZ");
        playWheelTick(0.8);
      } else if (g.phase === "aimZ") {
        enter("drop");
        playWheelTick(0.8);
      }
    });
    enterRef.current = enter; // the frame loop advances phases too
    return () => {
      off();
      setPhase("idle");
    };
  }, []);

  // Marquee chaser LEDs.
  const LEDS = 28;
  useEffect(() => {
    const m = marqueeLeds.current;
    if (!m) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < LEDS; i++) {
      const side = i < LEDS / 2 ? 1 : -1;
      const k = i % (LEDS / 2);
      o.position.set(-W / 2 + 0.08 + (k / (LEDS / 2 - 1)) * (W - 0.16), GLASS_TOP + 0.3, side * (D / 2 + 0.012));
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, []);
  const ledOn = useMemo(() => new THREE.Color(1, 0.85, 0.55), []);
  const ledOff = useMemo(() => new THREE.Color(0.25, 0.12, 0.08), []);

  useFrame((_, dt) => {
    const g = game.current;
    const now = performance.now() / 1000;
    const t = now - g.t0;
    const step = Math.min(dt, 0.05);
    const enter = enterRef.current;
    const ps = prizes.current;

    switch (g.phase) {
      case "idle":
        g.x += (CHUTE.x - g.x) * Math.min(1, step * 3);
        g.z += (CHUTE.z - g.z) * Math.min(1, step * 3);
        g.y = REST_Y + Math.sin(now * 1.6) * 0.004;
        g.open += (0.3 - g.open) * Math.min(1, step * 4);
        break;
      case "aimX":
        g.x = sweep(t, 0.34, CLAW_LIMIT_X, g.from.x);
        if (t > AIM_TIMEOUT) {
          g.from = { x: g.x, z: g.z };
          enter("aimZ");
        }
        break;
      case "aimZ":
        g.z = sweep(t, 0.3, CLAW_LIMIT_Z, g.from.z);
        if (t > AIM_TIMEOUT) enter("drop");
        break;
      case "drop": {
        const k = Math.min(1, t / 1.4);
        g.y = REST_Y + (LOW_Y - REST_Y) * easeInOut(k);
        g.open = Math.min(1, g.open + step * 2.5);
        if (k >= 1) {
          const avail = ps.map((p) => p.state === "rest");
          const i = nearestPrize(ps, avail, g.x, g.z);
          g.held = i;
          if (i >= 0) {
            const d = Math.hypot(ps[i]!.x - g.x, ps[i]!.z - g.z);
            g.willSlip = randomUnit() > gripChance(d);
            g.slipAt = 0.25 + randomUnit() * 0.5;
          }
          enter("grab");
        }
        break;
      }
      case "grab": {
        const k = Math.min(1, t / 0.7);
        g.open = 1 - k;
        if (g.held >= 0) {
          const p = ps[g.held]!;
          // the prize is pulled toward the centre of the closing fingers
          p.x += (g.x - p.x) * k * 0.15;
          p.z += (g.z - p.z) * k * 0.15;
        }
        if (k >= 1) {
          if (g.held >= 0) ps[g.held]!.state = "held";
          enter("lift");
        }
        break;
      }
      case "lift": {
        const k = Math.min(1, t / 1.3);
        g.y = LOW_Y + (REST_Y - LOW_Y) * easeInOut(k);
        if (g.held >= 0 && g.willSlip && k >= g.slipAt) {
          const p = ps[g.held]!;
          p.state = "fall";
          p.vy = 0;
          g.held = -1;
          g.open = 0.25; // fingers spring open a little as it slips
        }
        if (k >= 1) {
          g.from = { x: g.x, z: g.z };
          enter("carry");
        }
        break;
      }
      case "carry": {
        const dist = Math.hypot(CHUTE.x - g.from.x, CHUTE.z - g.from.z);
        const dur = Math.max(0.6, dist * 2.2);
        const k = Math.min(1, t / dur);
        const e = easeInOut(k);
        g.x = g.from.x + (CHUTE.x - g.from.x) * e;
        g.z = g.from.z + (CHUTE.z - g.from.z) * e;
        if (k >= 1) enter("release");
        break;
      }
      case "release": {
        const k = Math.min(1, t / 0.6);
        g.open = Math.max(g.open, k);
        if (g.held >= 0) {
          const p = ps[g.held]!;
          p.state = "fall";
          p.vy = 0;
          g.held = -1;
          g.won = true;
          const def = PRIZES[ps.indexOf(p)]!;
          useStoreUi.getState().showToast(`🎉 You won a ${def.name}! (just for fun)`);
          playWheelWin();
        }
        if (k >= 1) {
          if (!g.won) useStoreUi.getState().showToast("So close! Press E to try again.");
          enter("home");
        }
        break;
      }
      case "home":
        g.open += (0.3 - g.open) * Math.min(1, step * 4);
        if (t > 0.6) enter("idle");
        break;
    }
    // motor ticks while the gantry moves
    if ((g.phase === "aimX" || g.phase === "aimZ" || g.phase === "carry") && now - g.lastTick > 0.18) {
      g.lastTick = now;
      playWheelTick(0.12);
    }

    // ── prizes ──
    ps.forEach((p, i) => {
      if (p.state === "held") {
        p.x = g.x;
        p.z = g.z;
        p.y = g.y - HOLD_DROP;
      } else if (p.state === "fall") {
        p.vy -= 9.8 * step;
        p.y += p.vy * step;
        const inChute = Math.abs(p.x - CHUTE.x) < CHUTE.half && Math.abs(p.z - CHUTE.z) < CHUTE.half;
        const floor = inChute ? 0.35 : DECK_Y + 0.075;
        if (p.y <= floor) {
          p.y = floor;
          p.vy = 0;
          playDrop();
          if (inChute) {
            p.state = "gone";
            p.respawnAt = now + 10;
          } else {
            p.state = "rest";
          }
        }
      } else if (p.state === "gone" && now > p.respawnAt) {
        const def = PRIZES[i]!;
        p.x = def.x;
        p.z = def.z;
        p.y = DECK_Y + 0.075;
        p.state = "rest";
        p.scale = 0;
      }
      if (p.state !== "gone" && p.scale < 1) p.scale = Math.min(1, p.scale + step * 2);
      const obj = prizeGroups.current[i];
      if (obj) {
        obj.visible = p.state !== "gone";
        obj.position.set(p.x, p.y, p.z);
        obj.scale.setScalar(p.scale);
      }
    });

    // ── rig ──
    if (bridge.current) bridge.current.position.z = g.z;
    if (trolley.current) trolley.current.position.set(g.x, 0, g.z);
    if (clawHub.current) clawHub.current.position.set(g.x, g.y, g.z);
    if (cable.current) {
      const len = RAIL_Y - 0.04 - g.y;
      cable.current.scale.y = len;
      cable.current.position.set(g.x, g.y + len / 2, g.z);
    }
    const ang = FINGER_CLOSED + (FINGER_OPEN - FINGER_CLOSED) * g.open;
    fingers.current.forEach((f) => {
      if (f) f.rotation.z = ang;
    });

    // ── lights ──
    const m = marqueeLeds.current;
    if (m) {
      const playing = g.phase !== "idle";
      const kk = Math.floor(now * (playing ? 14 : 5));
      for (let i = 0; i < LEDS; i++) m.setColorAt(i, (i + kk) % 4 !== 0 ? ledOn : ledOff);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (button.current) {
      const mat = button.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = g.phase === "aimX" || g.phase === "aimZ" ? 1 + Math.abs(Math.sin(now * 8)) * 2 : 1.2;
    }
  });

  const front = [-1, 1] as const; // twin-sided cabinet: controls on both ±z faces

  return (
    <group position={[x, 0, z]}>
      <group ref={root}>
        {/* ── base cabinet ── */}
        <mesh position={[0, 0.04, 0]} material={mats.rubber} receiveShadow>
          <boxGeometry args={[W - 0.04, 0.08, D - 0.04]} />
        </mesh>
        <RoundedBox args={[W, BASE_H - 0.08, D]} radius={0.03} smoothness={3} position={[0, 0.08 + (BASE_H - 0.08) / 2, 0]} material={mats.lacquer} castShadow receiveShadow />
        {/* brushed steel trim bands */}
        {[0.12, BASE_H - 0.02].map((y) => (
          <mesh key={y} position={[0, y, 0]} material={mats.steel}>
            <boxGeometry args={[W + 0.012, 0.03, D + 0.012]} />
          </mesh>
        ))}
        {front.map((s) => (
          <group key={s} position={[0, 0, s * (D / 2)]} rotation-y={s < 0 ? Math.PI : 0}>
            {/* inset lower panel */}
            <mesh position={[-0.2, 0.48, 0.004]} material={mats.lacquerDark}>
              <boxGeometry args={[0.62, 0.52, 0.01]} />
            </mesh>
            {/* prize door: steel frame + smoked swing flap */}
            <group position={[CHUTE.x, 0.38, 0]}>
              <mesh position={[0, 0, 0.012]} material={mats.steel}>
                <boxGeometry args={[0.3, 0.3, 0.02]} />
              </mesh>
              <mesh position={[0, 0, 0.024]} material={mats.black}>
                <boxGeometry args={[0.25, 0.25, 0.01]} />
              </mesh>
              <mesh position={[0, 0.01, 0.031]} rotation-x={-0.12} material={mats.smoked}>
                <planeGeometry args={[0.23, 0.22]} />
              </mesh>
              <Text position={[0, 0.2, 0.025]} fontSize={0.035} letterSpacing={0.2} color="#f3ede0" anchorX="center" anchorY="middle">
                PRIZE
              </Text>
            </group>
            {/* payment terminal (free play) */}
            <group position={[-0.42, 0.62, 0.012]}>
              <RoundedBox args={[0.16, 0.22, 0.03]} radius={0.01} smoothness={2} material={mats.alu} />
              <mesh position={[0, 0.04, 0.016]} material={mats.screen}>
                <planeGeometry args={[0.11, 0.07]} />
              </mesh>
              <Text position={[0, 0.04, 0.018]} fontSize={0.022} color="#062a1f" anchorX="center" anchorY="middle" fontWeight={800}>
                FREE PLAY
              </Text>
              <mesh position={[0, -0.06, 0.016]} material={mats.black}>
                <boxGeometry args={[0.08, 0.008, 0.004]} />
              </mesh>
            </group>
            {/* control deck: sloped panel, joystick, glowing drop button */}
            <group position={[0, BASE_H - 0.05, 0.07]} rotation-x={0.28}>
              <RoundedBox args={[1.0, 0.05, 0.2]} radius={0.015} smoothness={2} material={mats.alu} castShadow />
              <mesh position={[0, 0.026, 0]} material={mats.steel}>
                <boxGeometry args={[0.96, 0.002, 0.16]} />
              </mesh>
              <group position={[-0.2, 0.03, 0]}>
                <mesh material={mats.black}>
                  <cylinderGeometry args={[0.04, 0.045, 0.012, 20]} />
                </mesh>
                <mesh position={[0, 0.05, 0]} material={mats.chrome}>
                  <cylinderGeometry args={[0.009, 0.009, 0.09, 10]} />
                </mesh>
                <mesh position={[0, 0.105, 0]} material={mats.knob}>
                  <sphereGeometry args={[0.03, 20, 16]} />
                </mesh>
              </group>
              <group position={[0.22, 0.03, 0]}>
                <mesh material={mats.chrome}>
                  <cylinderGeometry args={[0.052, 0.052, 0.014, 24]} />
                </mesh>
                <mesh ref={s > 0 ? button : undefined} position={[0, 0.014, 0]} scale={[1, 0.45, 1]} material={mats.buttonGlow}>
                  <sphereGeometry args={[0.042, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
                </mesh>
                <Text position={[0, 0.009, 0.07]} rotation-x={-Math.PI / 2} fontSize={0.022} letterSpacing={0.15} color="#e9e4da" anchorX="center" anchorY="middle">
                  DROP
                </Text>
              </group>
            </group>
          </group>
        ))}

        {/* ── glass showcase ── */}
        <mesh position={[0, DECK_Y - 0.01, 0]} material={mats.deck} receiveShadow>
          <boxGeometry args={[W - 0.06, 0.02, D - 0.06]} />
        </mesh>
        {front.map((s) => (
          <mesh key={`gz${s}`} position={[0, (DECK_Y + GLASS_TOP) / 2, s * (D / 2 - 0.02)]} material={mats.glass}>
            <planeGeometry args={[W - 0.06, GLASS_TOP - DECK_Y]} />
          </mesh>
        ))}
        {front.map((s) => (
          <mesh key={`gx${s}`} position={[s * (W / 2 - 0.02), (DECK_Y + GLASS_TOP) / 2, 0]} rotation-y={Math.PI / 2} material={mats.glass}>
            <planeGeometry args={[D - 0.06, GLASS_TOP - DECK_Y]} />
          </mesh>
        ))}
        {/* aluminium frame: corner posts + top/bottom rails */}
        {front.flatMap((sx) =>
          front.map((sz) => (
            <mesh key={`p${sx}${sz}`} position={[sx * (W / 2 - 0.02), (DECK_Y + GLASS_TOP) / 2, sz * (D / 2 - 0.02)]} material={mats.alu} castShadow>
              <boxGeometry args={[0.045, GLASS_TOP - DECK_Y, 0.045]} />
            </mesh>
          )),
        )}
        {[DECK_Y + 0.01, GLASS_TOP].flatMap((y) => [
          ...front.map((s) => (
            <mesh key={`rz${y}${s}`} position={[0, y, s * (D / 2 - 0.02)]} material={mats.alu}>
              <boxGeometry args={[W, 0.035, 0.045]} />
            </mesh>
          )),
          ...front.map((s) => (
            <mesh key={`rx${y}${s}`} position={[s * (W / 2 - 0.02), y, 0]} material={mats.alu}>
              <boxGeometry args={[0.045, 0.035, D]} />
            </mesh>
          )),
        ])}
        {/* prize chute: clear acrylic walls with a chrome rim */}
        <group position={[CHUTE.x, DECK_Y, CHUTE.z]}>
          {[-1, 1].map((s) => (
            <mesh key={`a${s}`} position={[s * CHUTE.half, 0.08, 0]} rotation-y={Math.PI / 2} material={mats.acrylic}>
              <planeGeometry args={[CHUTE.half * 2, 0.16]} />
            </mesh>
          ))}
          {[-1, 1].map((s) => (
            <mesh key={`b${s}`} position={[0, 0.08, s * CHUTE.half]} material={mats.acrylic}>
              <planeGeometry args={[CHUTE.half * 2, 0.16]} />
            </mesh>
          ))}
          <mesh position={[0, 0.16, 0]} rotation-x={Math.PI / 2} material={mats.chrome}>
            <torusGeometry args={[CHUTE.half * 1.41, 0.006, 6, 4, Math.PI * 2]} />
          </mesh>
          <mesh position={[0, 0.002, 0]} rotation-x={-Math.PI / 2} material={mats.black}>
            <planeGeometry args={[CHUTE.half * 2 - 0.01, CHUTE.half * 2 - 0.01]} />
          </mesh>
        </group>

        {/* ── prizes ── */}
        {PRIZES.map((p, i) => (
          <group key={i} ref={(el) => void (prizeGroups.current[i] = el)} position={[p.x, DECK_Y + 0.075, p.z]}>
            {p.kind === "bear" ? <PlushBear def={p} mats={mats} /> : <Capsule def={p} mats={mats} />}
          </group>
        ))}

        {/* ── gantry: side rails, moving bridge, trolley ── */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (W / 2 - 0.07), RAIL_Y, 0]} material={mats.steel}>
            <boxGeometry args={[0.03, 0.03, D - 0.1]} />
          </mesh>
        ))}
        <group ref={bridge}>
          <mesh position={[0, RAIL_Y - 0.005, 0]} material={mats.alu}>
            <boxGeometry args={[W - 0.12, 0.035, 0.05]} />
          </mesh>
        </group>
        <group ref={trolley}>
          <RoundedBox args={[0.1, 0.06, 0.09]} radius={0.01} smoothness={2} position={[0, RAIL_Y - 0.04, 0]} material={mats.steel} />
        </group>
        <mesh ref={cable} material={mats.chrome}>
          <cylinderGeometry args={[0.003, 0.003, 1, 6]} />
        </mesh>
        {/* claw: motor housing + three articulated fingers */}
        <group ref={clawHub} position={[CHUTE.x, REST_Y, CHUTE.z]}>
          <mesh position={[0, 0.02, 0]} material={mats.chrome} castShadow>
            <cylinderGeometry args={[0.036, 0.05, 0.07, 24]} />
          </mesh>
          <mesh position={[0, -0.025, 0]} material={mats.alu}>
            <cylinderGeometry args={[0.056, 0.056, 0.025, 24]} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <Finger key={i} angle={(i * Math.PI * 2) / 3 + Math.PI / 6} mats={mats} fingerRef={(el) => void (fingers.current[i] = el)} />
          ))}
        </group>
        {/* interior LED light bar under the roof */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0, GLASS_TOP - 0.035, s * (D / 2 - 0.06)]} material={mats.led}>
            <boxGeometry args={[W - 0.16, 0.012, 0.02]} />
          </mesh>
        ))}

        {/* ── marquee ── */}
        <RoundedBox args={[W + 0.02, 0.4, D + 0.02]} radius={0.03} smoothness={3} position={[0, GLASS_TOP + 0.2, 0]} material={mats.lacquer} castShadow />
        {front.map((s) => (
          <group key={s} position={[0, GLASS_TOP + 0.17, s * (D / 2 + 0.012)]} rotation-y={s < 0 ? Math.PI : 0}>
            <mesh material={mats.marquee}>
              <planeGeometry args={[W - 0.16, 0.2]} />
            </mesh>
            <Text position={[0, 0.005, 0.003]} fontSize={0.12} letterSpacing={0.22} color="#fff6e6" outlineWidth={0.004} outlineColor="#ff3346" anchorX="center" anchorY="middle" fontWeight={800}>
              PRIZE CLAW
            </Text>
          </group>
        ))}
        <instancedMesh ref={marqueeLeds} args={[undefined, undefined, LEDS]} material={mats.led}>
          <sphereGeometry args={[0.011, 10, 8]} />
          <instancedBufferAttribute attach="instanceColor" args={[new Float32Array(LEDS * 3).fill(0.6), 3]} />
        </instancedMesh>
        <mesh position={[0, GLASS_TOP + 0.41, 0]} material={mats.steel}>
          <boxGeometry args={[W + 0.03, 0.02, D + 0.03]} />
        </mesh>
      </group>
    </group>
  );
}

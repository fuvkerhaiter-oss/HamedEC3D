"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard, Text, useGLTF } from "@react-three/drei";
import { ASSETS } from "../assets/registry";
import { basketSlot, TROLLEY, unitJitter } from "../trolley/geometry";
import { ITEM_BOX, itemMaterial, useBasketUnits, type TrolleyCatalog } from "../trolley/visuals";
import { EMOTE_DURATION_MS, emoteDef, type EmoteId } from "./emotes";
import { remoteEmotes, remotePoses, sendPose, setListener, setMyBasket, setVoicePosition, useNet, voiceLevel, type Member } from "./net";

const EYE_HEIGHT = 1.6; // poses are camera positions; feet are this far below
/** Same place as my own trolley: in front of the shopper, origin on the floor (avatar-local, front = -Z). */
export const TROLLEY_Z = TROLLEY.offsetFromPlayer[2];
const dir = new THREE.Vector3();
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// Arms reach from the shoulders to the trolley handle.
export const SHOULDER = { y: 1.15, z: -0.12 };
export const HAND = { y: 0.98, z: TROLLEY_Z + 0.5 };
export const ARM = {
  len: Math.hypot(HAND.y - SHOULDER.y, HAND.z - SHOULDER.z),
  tilt: Math.atan2(HAND.z - SHOULDER.z, HAND.y - SHOULDER.y),
  mid: [(SHOULDER.y + HAND.y) / 2, (SHOULDER.z + HAND.z) / 2] as const,
};

// Shared geometry for every avatar (no per-avatar allocations).
export const GEO = {
  body: new THREE.CapsuleGeometry(0.28, 0.75, 4, 12),
  head: new THREE.SphereGeometry(0.2, 20, 14),
  eye: new THREE.SphereGeometry(0.03, 8, 6),
  ring: new THREE.TorusGeometry(0.34, 0.025, 6, 32),
  arm: new THREE.CapsuleGeometry(0.055, 1, 3, 8),
};
export const SKIN = new THREE.MeshStandardMaterial({ color: "#f1c9a5", roughness: 0.7 });
export const EYE = new THREE.MeshBasicMaterial({ color: "#111513" });
const MIC = new THREE.MeshBasicMaterial({ color: "#3bdc7a" });

/** Other shoppers in my room (each pushing a trolley with what they picked) + sends my own pose and basket. */
export function RemotePlayers({ tc }: { tc: TrolleyCatalog }) {
  const members = useNet((s) => s.members);
  const camera = useThree((s) => s.camera);
  const { scene } = useGLTF(ASSETS.trolley.url);
  const units = useBasketUnits(tc);
  useEffect(() => setMyBasket(units.map((u) => u.productId)), [units]);
  useFrame(() => {
    camera.getWorldDirection(dir);
    const { x, y, z } = camera.position;
    sendPose(x, y, z, Math.atan2(-dir.x, -dir.z), performance.now());
    setListener(x, y, z, dir.x, dir.z);
  });
  return <>{members.map((m) => <Avatar key={m.id} member={m} trolley={scene} tc={tc} />)}</>;
}

function Avatar({ member, trolley, tc }: { member: Member; trolley: THREE.Object3D; tc: TrolleyCatalog }) {
  const root = useRef<THREE.Group>(null);
  const char = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const emoteBadge = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const cart = useRef<THREE.Group>(null);
  const plus = useRef<THREE.Group>(null);
  const placed = useRef(false);
  const motion = useRef({ speed: 0, jiggle: 0, popId: 0, popAt: -10 });
  const [activeEmote, setActiveEmote] = useState<EmoteId | null>(null);
  const body = useMemo(() => new THREE.MeshStandardMaterial({ color: member.color, roughness: 0.55 }), [member.color]);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#3bdc7a", transparent: true, opacity: 0 }), []);
  const model = useMemo(() => {
    const s = trolley.clone(true);
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = ASSETS.trolley.castShadow;
    });
    return s;
  }, [trolley]);

  // "+N" pops over their head when they grab something (state adjusted during render, React's documented pattern).
  const count = member.basket.length;
  const [prevCount, setPrevCount] = useState(count);
  const [pop, setPop] = useState<{ n: number; id: number } | null>(null);
  if (count !== prevCount) {
    setPrevCount(count);
    if (count > prevCount) setPop((p) => ({ n: count - prevCount, id: (p?.id ?? 0) + 1 }));
  }

  // Unit keys stay stable as items are added, so only the new ones drop in.
  const items = useMemo(() => {
    const seen = new Map<string, number>();
    return member.basket.map((productId) => {
      const n = seen.get(productId) ?? 0;
      seen.set(productId, n + 1);
      return { key: `${productId}#${n}`, productId };
    });
  }, [member.basket]);

  useFrame((state, delta) => {
    const g = root.current;
    const r = remotePoses.get(member.id);
    if (!g) return;
    g.visible = !!r;
    if (!r) return;
    const [x, y, z, yaw] = r.pose;
    const feet = y - EYE_HEIGHT;
    const mo = motion.current;
    const dt = Math.min(delta, 0.1);
    if (!placed.current) {
      g.position.set(x, feet, z);
      g.rotation.y = yaw;
      placed.current = true;
    } else {
      const k = 1 - Math.exp(-12 * dt); // smooth 10 Hz updates
      const dx = (x - g.position.x) * k;
      const dz = (z - g.position.z) * k;
      g.position.x += dx;
      g.position.y += (feet - g.position.y) * k;
      g.position.z += dz;
      g.rotation.y += wrap(yaw - g.rotation.y) * k;
      mo.speed += (Math.hypot(dx, dz) / Math.max(dt, 1e-3) - mo.speed) * 0.2;
    }
    setVoicePosition(member.id, g.position.x, g.position.y + EYE_HEIGHT, g.position.z);
    const level = voiceLevel(member.id);
    const rm = ring.current?.material as THREE.MeshBasicMaterial | undefined;
    if (rm) rm.opacity += ((level > 0.08 ? 0.9 : 0) - rm.opacity) * 0.3;
    ring.current?.scale.setScalar(1 + level * 0.4);

    // Trolley rattle while rolling + a bounce whenever something lands in it.
    const t = state.clock.elapsedTime;
    if (pop && pop.id !== mo.popId) {
      mo.popId = pop.id;
      mo.popAt = t;
      mo.jiggle = 1;
    }
    mo.jiggle *= Math.exp(-4 * dt);
    const rolling = Math.min(1, mo.speed / 2);
    const c = cart.current;
    if (c) {
      c.rotation.z = Math.sin(t * 38) * 0.04 * mo.jiggle + Math.sin(t * 9) * 0.008 * rolling;
      c.rotation.x = Math.sin(t * 31) * 0.02 * mo.jiggle;
      c.position.y = Math.abs(Math.sin(t * 14)) * 0.06 * mo.jiggle + Math.abs(Math.sin(t * 17)) * 0.004 * rolling;
    }
    const p = plus.current;
    if (p) {
      const a = t - mo.popAt;
      p.visible = a < 1.3;
      p.position.y = 2.15 + a * 0.45;
      p.scale.setScalar(a < 0.18 ? (a / 0.18) * 1.3 : 1.3 - Math.min(0.3, (a - 0.18) * 1.5));
    }

    // Emote choreography (visible to all shoppers in the room)
    const em = remoteEmotes.get(member.id);
    const emAge = em ? performance.now() - em.startedAt : Infinity;
    const curEmote = em && emAge < EMOTE_DURATION_MS ? em.emote : null;
    if (curEmote !== activeEmote) setActiveEmote(curEmote);
    const ch = char.current;
    const hd = head.current;
    const la = leftArm.current;
    const ra = rightArm.current;
    const eb = emoteBadge.current;
    if (eb) {
      eb.visible = !!curEmote;
      if (curEmote) eb.position.y = 2.12 + Math.sin(t * 5) * 0.04;
    }
    if (ch && hd && la && ra) {
      if (curEmote === "dance") {
        ch.position.y = Math.abs(Math.sin(t * 8)) * 0.14;
        ch.rotation.z = Math.sin(t * 4) * 0.14;
        ch.rotation.y = Math.sin(t * 2) * 0.35;
        hd.rotation.z = -Math.sin(t * 4) * 0.2;
        hd.rotation.x = Math.sin(t * 8) * 0.12;
        la.rotation.set(-0.4 + Math.sin(t * 8) * 0.9, 0, -0.55 - Math.cos(t * 4) * 0.3);
        ra.rotation.set(-0.4 - Math.sin(t * 8) * 0.9, 0, 0.55 + Math.cos(t * 4) * 0.3);
      } else if (curEmote === "wave") {
        ch.position.y = Math.abs(Math.sin(t * 3)) * 0.04;
        ch.rotation.set(0, 0, 0);
        hd.rotation.set(0, 0, Math.sin(t * 4) * 0.12);
        la.rotation.set(ARM.tilt, 0, 0);
        ra.rotation.set(-2.3, 0, 0.45 + Math.sin(t * 11) * 0.5);
      } else if (curEmote === "spin") {
        ch.position.y = Math.abs(Math.sin(t * 5)) * 0.1;
        ch.rotation.set(0, t * 7.5, 0);
        hd.rotation.set(0, 0, 0);
        la.rotation.set(0, 0, -1.35);
        ra.rotation.set(0, 0, 1.35);
      } else if (curEmote === "cheer") {
        ch.position.y = Math.abs(Math.sin(t * 9)) * 0.22;
        ch.rotation.set(0, 0, 0);
        hd.rotation.set(-0.2, 0, Math.sin(t * 6) * 0.1);
        la.rotation.set(-2.6, 0, -0.4 + Math.sin(t * 9) * 0.2);
        ra.rotation.set(-2.6, 0, 0.4 - Math.sin(t * 9) * 0.2);
      } else if (curEmote === "dab") {
        ch.position.y = 0;
        ch.rotation.set(0.08, -0.35, 0.1);
        hd.rotation.set(0.35, 0.4, -0.25);
        la.rotation.set(-1.3, 0.9, -0.4);
        ra.rotation.set(-2.1, -0.3, 1.15);
      } else if (curEmote === "laugh") {
        ch.position.y = Math.abs(Math.sin(t * 16)) * 0.06;
        ch.rotation.set(-0.18 + Math.sin(t * 16) * 0.06, 0, 0);
        hd.rotation.set(-0.32 + Math.sin(t * 16) * 0.12, 0, 0);
        la.rotation.set(-0.8, 0.5, 0.3);
        ra.rotation.set(-0.8, -0.5, -0.3);
      } else {
        ch.position.y *= 0.8;
        ch.rotation.set(ch.rotation.x * 0.8, ch.rotation.y * 0.8, ch.rotation.z * 0.8);
        hd.rotation.set(hd.rotation.x * 0.8, hd.rotation.y * 0.8, hd.rotation.z * 0.8);
        la.rotation.set(la.rotation.x + (ARM.tilt - la.rotation.x) * 0.2, 0, la.rotation.z * 0.8);
        ra.rotation.set(ra.rotation.x + (ARM.tilt - ra.rotation.x) * 0.2, 0, ra.rotation.z * 0.8);
      }
    }
  });

  return (
    <group ref={root} visible={false}>
      <group ref={char}>
        <mesh geometry={GEO.body} material={body} position={[0, 0.66, 0]} castShadow />
        <group ref={head} position={[0, 1.42, 0]}>
          <mesh geometry={GEO.head} material={SKIN} castShadow />
          <mesh geometry={GEO.eye} material={EYE} position={[-0.07, 0.03, -0.18]} />
          <mesh geometry={GEO.eye} material={EYE} position={[0.07, 0.03, -0.18]} />
        </group>
        <group ref={leftArm} position={[-0.22, SHOULDER.y, SHOULDER.z]} rotation-x={ARM.tilt}>
          <mesh geometry={GEO.arm} material={body} position={[0, (ARM.len - 0.11) / 2, 0]} scale={[1, ARM.len - 0.11, 1]} />
        </group>
        <group ref={rightArm} position={[0.22, SHOULDER.y, SHOULDER.z]} rotation-x={ARM.tilt}>
          <mesh geometry={GEO.arm} material={body} position={[0, (ARM.len - 0.11) / 2, 0]} scale={[1, ARM.len - 0.11, 1]} />
        </group>
      </group>
      <group ref={cart} position={[0, 0, TROLLEY_Z]}>
        <primitive object={model} scale={ASSETS.trolley.scale} rotation={ASSETS.trolley.rotation} position={ASSETS.trolley.position} />
        {items.map((it, i) => (
          <BasketItem key={it.key} unitKey={it.key} index={i} visual={tc.visuals.get(it.productId)} />
        ))}
      </group>
      <mesh ref={ring} geometry={GEO.ring} material={ringMat} position={[0, 0.03, 0]} rotation-x={Math.PI / 2} />
      <Billboard position={[0, 1.88, 0]}>
        <Text fontSize={0.13} color="#ffffff" outlineWidth={0.012} outlineColor="#111513" anchorX="center" anchorY="middle">
          {member.name}
        </Text>
        {count > 0 && (
          <Text position={[0, -0.13, 0]} fontSize={0.085} color="#ffc94d" outlineWidth={0.01} outlineColor="#111513" anchorX="center" anchorY="middle">
            {`${count}${count >= TROLLEY.maxVisibleItems ? "+" : ""} item${count === 1 ? "" : "s"} in trolley`}
          </Text>
        )}
        {/* Mic-open badge (troika's default font has no emoji). */}
        {member.mic && <mesh geometry={GEO.eye} material={MIC} position={[0, 0.15, 0]} scale={1.6} />}
      </Billboard>
      <Billboard ref={plus} visible={false}>
        {pop && (
          <Text fontSize={0.2} color="#3bdc7a" outlineWidth={0.018} outlineColor="#111513" anchorX="center" anchorY="middle">
            {`+${pop.n}`}
          </Text>
        )}
      </Billboard>
      <Billboard ref={emoteBadge} visible={false} position={[0, 2.12, 0]}>
        {activeEmote && (
          <Text fontSize={0.16} color="#ffd22b" outlineWidth={0.016} outlineColor="#111513" anchorX="center" anchorY="middle" fontWeight={800}>
            {emoteDef(activeEmote).badge}
          </Text>
        )}
      </Billboard>
    </group>
  );
}

/** One unit in another shopper's basket: drops in from above with a squashy bounce, then rests. */
function BasketItem({ unitKey, index, visual }: { unitKey: string; index: number; visual: { color: string; h: number; w: number } | undefined }) {
  const ref = useRef<THREE.Mesh>(null);
  const born = useRef<number | null>(null);
  const slot = basketSlot(index);
  useFrame((state) => {
    const m = ref.current;
    if (!m || !slot || !visual) return;
    born.current ??= state.clock.elapsedTime;
    const a = state.clock.elapsedTime - born.current;
    if (a > 1) return; // settled: no per-frame work
    const h = visual.h * TROLLEY.itemScale;
    const w = visual.w * TROLLEY.itemScale;
    const fall = Math.min(1, a / 0.35);
    const drop = (1 - fall * fall) * 0.9; // accelerate down from 0.9 m above the basket
    const bounce = fall < 1 ? 0 : Math.exp(-7 * (a - 0.35)) * Math.sin((a - 0.35) * 22); // landing wobble
    m.position.y = slot[1] + h / 2 + drop;
    m.scale.set(w * (1 + bounce * 0.25), h * (1 - bounce * 0.3), w * (1 + bounce * 0.25));
    m.rotation.y = unitJitter(unitKey) + (1 - fall) * 3;
  });
  if (!slot || !visual) return null;
  const h = visual.h * TROLLEY.itemScale;
  const w = visual.w * TROLLEY.itemScale;
  return (
    <mesh
      ref={ref}
      geometry={ITEM_BOX}
      material={itemMaterial(visual.color)}
      position={[slot[0], slot[1] + h / 2, slot[2]]}
      rotation-y={unitJitter(unitKey)}
      scale={[w, h, w]}
    />
  );
}

"use client";

/**
 * 3D "What's new / Coming soon" board in front of the chained wing. Hidden until the shopper walks up to the
 * chains (in the hall, within OPEN_RADIUS of the portal), then it unfolds row by row and floats there; walking away
 * folds it back; it turns (yaw only) to face the shopper. A hinged left wing ("On the way": the rewards season)
 * swings open from behind the main board like a door, then its rows pop in.
 * Pure 3D (no DOM), not pickable by the crosshair. Content: ./updates.ts.
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Text } from "@react-three/drei";
import { playWhoosh } from "@/lib/fx/whoosh";
import { useStoreUi } from "../ui-store";
import { ON_THE_WAY, UPDATES, type UpdateIcon, type UpdateItem } from "./updates";

const OPEN_RADIUS = 7.5;
const CLOSE_RADIUS = 8.5; // hysteresis: no flicker on the edge
const W = 4.6;
const H = 2.85;
const Y = 1.72;
const AMBER = "#f7c416";
const MINT = "#4fd39a";
const CREAM = "#f7f4ee";
const MUTED = "#a9b5af";

const ROW_H = 0.38;
const COL_X = [-W / 4 - 0.02, W / 4 + 0.02];
const TOP = 0.6; // column headings, relative to the panel centre

// Left wing ("On the way"): hinged on the main board's left edge, angled toward the shopper when open.
const WW = 2.65;
const GAP = 0.07;
const HINGE_OPEN = 0.32; // rad, turned toward the viewer
const HINGE_CLOSED = -1.45; // folded back behind the main board
const WING_ROW_TOP = 0.52;
const WING_ROW_H = 0.37;
const WL = -GAP / 2 - WW + 0.25; // wing content left edge (wing-local x)
const WR = -GAP / 2 - 0.22; // wing content right edge
const TILE = "#18231e";
/** How far the board may turn from facing the hall (keeps the open wing clear of the fridges and the chains). */
const YAW_LIMIT = 0.45;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutBack = (t: number) => {
  const c = 1.5;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

export function UpdatesBoard({ center, gate }: { center: [number, number, number]; gate: [number, number] }) {
  const root = useRef<THREE.Group>(null);
  const float = useRef<THREE.Group>(null);
  const rim = useRef<THREE.MeshStandardMaterial>(null);
  const wing = useRef<THREE.Group>(null);
  const wingRim = useRef<THREE.MeshStandardMaterial>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshStandardMaterial>(null);
  const rows = useRef<(THREE.Group | null)[]>([]);
  const state = useRef({ open: false, p: 0, yaw: -Math.PI / 2 });

  useFrame(({ camera, clock }, dt) => {
    const s = state.current;
    const dx = camera.position.x - gate[0];
    const dz = camera.position.z - gate[1];
    const dist = Math.hypot(dx, dz);
    const inHall = camera.position.x < gate[0];
    const wasOpen = s.open;
    s.open = inHall && dist < (s.open ? CLOSE_RADIUS : OPEN_RADIUS);
    if (s.open && !wasOpen && useStoreUi.getState().stage === "play") playWhoosh(0.18);
    s.p = clamp01(s.p + (s.open ? 1 : -1.6) * Math.min(dt, 0.05) * 1.25);

    const g = root.current;
    if (!g) return;
    g.visible = s.p > 0.001;
    if (!g.visible) return;
    // Turn (yaw only, smoothed) toward the shopper, within ±YAW_LIMIT of facing the hall.
    const want = Math.atan2(camera.position.x - center[0], camera.position.z - center[2]);
    const target = -Math.PI / 2 + Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, wrap(want + Math.PI / 2)));
    s.yaw += wrap(target - s.yaw) * Math.min(1, dt * 4);
    g.rotation.y = s.yaw;
    const e = easeOutBack(clamp01(s.p * 1.4));
    g.scale.setScalar(Math.max(0.001, 0.6 + 0.4 * e));
    if (float.current) {
      float.current.position.y = Y - 0.35 * (1 - e) + Math.sin(clock.elapsedTime * 1.2) * 0.025;
      float.current.rotation.x = (1 - e) * -0.5;
    }
    const glow = (0.8 + 0.35 * Math.sin(clock.elapsedTime * 2.2)) * clamp01(s.p * 2);
    if (rim.current) rim.current.emissiveIntensity = glow;
    if (wingRim.current) wingRim.current.emissiveIntensity = glow;
    if (wing.current) {
      // The wing swings out from behind the main board just after it appears.
      const h = easeOutBack(clamp01(s.p * 1.8 - 0.3));
      wing.current.rotation.y = HINGE_CLOSED + (HINGE_OPEN - HINGE_CLOSED) * h;
      wing.current.visible = h > 0.01;
    }
    if (ringMat.current) ringMat.current.opacity = 0.45 * clamp01(s.p * 2);
    if (ring.current) ring.current.rotation.z = clock.elapsedTime * 0.25;
    rows.current.forEach((r, i) => {
      if (!r) return;
      // Every row (incl. the wing's last one) completes; rows never sink behind the panel face.
      const q = easeOutBack(clamp01(s.p * 2.6 - 0.3 - i * 0.05));
      r.scale.set(Math.max(0.001, q), Math.max(0.001, q), 1);
      r.position.z = 0.03 + Math.max(0, 1 - q) * 0.25;
    });
  });

  let rowIndex = 0;
  const row = () => rowIndex++;
  const header = row();
  const colHead = [row(), row()];
  const wingHeader = row();
  return (
    <group ref={root} position={center} visible={false}>
      {/* Floor halo under the board + wing. */}
      <mesh ref={ring} position={[-1.1, 0.105, 0.35]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[1.9, 1.96, 96, 1, 0, Math.PI * 1.7]} />
        <meshStandardMaterial ref={ringMat} color={AMBER} emissive={AMBER} emissiveIntensity={1.6} toneMapped={false} transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={float} position={[0, Y, 0]}>
        {/* Amber rim (only its edge shows) + dark panel. */}
        <RoundedBox args={[W + 0.07, H + 0.07, 0.03]} radius={0.12} smoothness={4} position={[0, 0, -0.02]}>
          <meshStandardMaterial ref={rim} color={AMBER} emissive={AMBER} emissiveIntensity={0} toneMapped={false} />
        </RoundedBox>
        <RoundedBox args={[W, H, 0.05]} radius={0.1} smoothness={4}>
          <meshStandardMaterial color="#0b1210" roughness={0.3} metalness={0.25} />
        </RoundedBox>

        <group ref={(r) => { rows.current[header] = r; }} position={[0, H / 2 - 0.36, 0.03]}>
          <Text position={[-W / 2 + 0.3, 0.13, 0]} fontSize={0.085} letterSpacing={0.32} color={AMBER} anchorX="left" anchorY="middle">
            WEGO SHIIIP · STORE UPDATES
          </Text>
          <Text position={[-W / 2 + 0.3, -0.07, 0]} fontSize={0.2} color={CREAM} anchorX="left" anchorY="middle">
            {"What's new & what's coming"}
          </Text>
          <mesh position={[0, -0.24, 0]}>
            <planeGeometry args={[W - 0.6, 0.006]} />
            <meshBasicMaterial color="#2f3c37" />
          </mesh>
        </group>

        {(["new", "soon"] as const).map((kind, c) => (
          <group key={kind}>
            <group ref={(r) => { rows.current[colHead[c]!] = r; }} position={[COL_X[c]!, TOP, 0.03]}>
              <Pill x={-W / 4 + 0.38} label={kind === "new" ? "JUST LANDED" : "COMING SOON"} color={kind === "new" ? MINT : AMBER} />
            </group>
            {UPDATES[kind].map((item, i) => {
              const idx = rowIndex++;
              return (
                <group key={item.title} ref={(r) => { rows.current[idx] = r; }} position={[COL_X[c]!, TOP - 0.36 - i * ROW_H, 0.03]}>
                  <Item item={item} accent={kind === "new" ? MINT : AMBER} />
                </group>
              );
            })}
          </group>
        ))}

        <Text position={[0, -H / 2 + 0.16, 0.04]} fontSize={0.065} letterSpacing={0.12} color={MUTED} anchorX="center" anchorY="middle">
          THIS WING IS CHAINED SHUT FOR NOW · CHECK BACK SOON
        </Text>

        {/* Hinge: a lit seam between the two panels. */}
        <mesh position={[-W / 2 - GAP / 2, 0, 0]}>
          <boxGeometry args={[0.025, H * 0.78, 0.025]} />
          <meshBasicMaterial color={AMBER} toneMapped={false} />
        </mesh>

        {/* Left wing: "On the way". */}
        <group ref={wing} position={[-W / 2 - GAP / 2, 0, 0]} rotation-y={HINGE_CLOSED} visible={false}>
          <RoundedBox args={[WW + 0.07, H + 0.07, 0.03]} radius={0.12} smoothness={4} position={[-GAP / 2 - WW / 2, 0, -0.02]}>
            <meshStandardMaterial ref={wingRim} color={AMBER} emissive={AMBER} emissiveIntensity={0} toneMapped={false} />
          </RoundedBox>
          <RoundedBox args={[WW, H, 0.05]} radius={0.1} smoothness={4} position={[-GAP / 2 - WW / 2, 0, 0]}>
            <meshStandardMaterial color="#0b1210" roughness={0.3} metalness={0.25} />
          </RoundedBox>

          <group ref={(r) => { rows.current[wingHeader] = r; }} position={[0, H / 2 - 0.36, 0.03]}>
            <Text position={[WL, 0.13, 0]} fontSize={0.07} letterSpacing={0.3} color={AMBER} anchorX="left" anchorY="middle">
              WEGO REWARDS · SEASON 01
            </Text>
            <TagPill right={WR + 0.08} y={0.13} label="ON THE WAY" />
            <Text position={[WL, -0.07, 0]} fontSize={0.2} color={CREAM} anchorX="left" anchorY="middle">
              Play. Earn. Win.
            </Text>
            <mesh position={[(WL + WR + 0.08) / 2, -0.24, 0]}>
              <planeGeometry args={[WR + 0.08 - WL, 0.006]} />
              <meshBasicMaterial color="#2f3c37" />
            </mesh>
          </group>

          {ON_THE_WAY.map((item, i) => {
            const idx = rowIndex++;
            return (
              <group key={item.title} ref={(r) => { rows.current[idx] = r; }} position={[0, WING_ROW_TOP - i * WING_ROW_H, 0.03]}>
                <WingItem item={item} n={i + 1} last={i === ON_THE_WAY.length - 1} />
              </group>
            );
          })}

          <Text position={[-GAP / 2 - WW / 2, -H / 2 + 0.16, 0.04]} fontSize={0.06} letterSpacing={0.14} color={MUTED} anchorX="center" anchorY="middle">
            REWARDS SEASON · DETAILS SOON
          </Text>
        </group>
      </group>
    </group>
  );
}

function Pill({ x, label, color }: { x: number; label: string; color: string }) {
  const w = 0.11 + label.length * 0.058;
  return (
    <group position={[x + w / 2 - 0.38, 0, 0]}>
      <RoundedBox args={[w, 0.15, 0.012]} radius={0.06} smoothness={3}>
        <meshBasicMaterial color={color} toneMapped={false} />
      </RoundedBox>
      <Text position={[0, -0.004, 0.012]} fontSize={0.07} letterSpacing={0.18} color="#0b1210" anchorX="center" anchorY="middle">
        {label}
      </Text>
    </group>
  );
}

/** Small pill anchored at its right edge. */
function TagPill({ right, y, label }: { right: number; y: number; label: string }) {
  const w = 0.11 + label.length * 0.052;
  return (
    <group position={[right - w / 2, y, 0]}>
      <RoundedBox args={[w, 0.14, 0.012]} radius={0.055} smoothness={3}>
        <meshBasicMaterial color={AMBER} toneMapped={false} />
      </RoundedBox>
      <Text position={[0, -0.004, 0.012]} fontSize={0.062} letterSpacing={0.18} color="#0b1210" anchorX="center" anchorY="middle">
        {label}
      </Text>
    </group>
  );
}

function Item({ item, accent }: { item: UpdateItem; accent: string }) {
  const left = -W / 4 + 0.4;
  return (
    <group>
      <mesh position={[left - 0.12, 0.045, 0]}>
        <circleGeometry args={[0.035, 20]} />
        <meshBasicMaterial color={accent} toneMapped={false} />
      </mesh>
      <Text position={[left, 0.05, 0]} fontSize={0.105} color={CREAM} anchorX="left" anchorY="middle">
        {item.title}
      </Text>
      <Text position={[left, -0.085, 0]} fontSize={0.07} maxWidth={W / 2 - 0.65} color={MUTED} anchorX="left" anchorY="middle">
        {item.text}
      </Text>
    </group>
  );
}

function WingItem({ item, n, last }: { item: UpdateItem & { icon: UpdateIcon }; n: number; last: boolean }) {
  const tx = WL + 0.38;
  return (
    <group>
      {/* Icon tile: dark tile with a fine gold edge. */}
      <group position={[WL + 0.14, -0.005, 0]}>
        <RoundedBox args={[0.29, 0.29, 0.012]} radius={0.07} smoothness={3} position={[0, 0, -0.004]}>
          <meshBasicMaterial color="#6e5c1c" toneMapped={false} />
        </RoundedBox>
        <RoundedBox args={[0.27, 0.27, 0.014]} radius={0.064} smoothness={3}>
          <meshStandardMaterial color={TILE} roughness={0.4} metalness={0.3} />
        </RoundedBox>
        <group position={[0, 0, 0.012]}>
          <FeatureIcon icon={item.icon} />
        </group>
      </group>
      <Text position={[tx, 0.06, 0]} fontSize={0.096} color={CREAM} anchorX="left" anchorY="middle">
        {item.title}
      </Text>
      <Text position={[tx, -0.068, 0]} fontSize={0.064} maxWidth={WR - tx - 0.16} color={MUTED} anchorX="left" anchorY="middle">
        {item.text}
      </Text>
      <Text position={[WR + 0.06, 0.06, 0]} fontSize={0.062} letterSpacing={0.1} color="#8a7426" anchorX="right" anchorY="middle">
        {String(n).padStart(2, "0")}
      </Text>
      {!last && (
        <mesh position={[(WL + WR + 0.06) / 2, -WING_ROW_H / 2, 0]}>
          <planeGeometry args={[WR + 0.06 - WL, 0.004]} />
          <meshBasicMaterial color="#1d2925" />
        </mesh>
      )}
    </group>
  );
}

/** Minimal flat gold icons (about 0.15 m), built from shapes: no textures or icon fonts to load. */
function FeatureIcon({ icon }: { icon: UpdateIcon }) {
  const shapes = useMemo(() => {
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.031 : 0.072;
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      if (i) star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const bolt = new THREE.Shape();
    const pts: [number, number][] = [[0.022, 0.085], [-0.05, -0.008], [-0.006, -0.008], [-0.022, -0.085], [0.05, 0.012], [0.006, 0.012]];
    pts.forEach(([x, y], i) => (i ? bolt.lineTo(x, y) : bolt.moveTo(x, y)));
    // Ticket with a half-round notch on each side.
    const ticket = new THREE.Shape();
    ticket.moveTo(-0.08, -0.048);
    ticket.lineTo(0.08, -0.048);
    ticket.lineTo(0.08, -0.018);
    ticket.absarc(0.08, 0, 0.018, -Math.PI / 2, Math.PI / 2, true);
    ticket.lineTo(0.08, 0.048);
    ticket.lineTo(-0.08, 0.048);
    ticket.lineTo(-0.08, 0.018);
    ticket.absarc(-0.08, 0, 0.018, Math.PI / 2, -Math.PI / 2, true);
    ticket.lineTo(-0.08, -0.048);
    return { star, bolt, ticket };
  }, []);
  const gold = <meshBasicMaterial color={AMBER} toneMapped={false} />;
  switch (icon) {
    case "levels":
      return (
        <group>
          {([[-0.05, 0.05, "#8f7621"], [0, 0.085, "#c9a01b"], [0.05, 0.12, AMBER]] as const).map(([x, h, c]) => (
            <mesh key={x} position={[x, -0.06 + h / 2, 0]}>
              <planeGeometry args={[0.032, h]} />
              <meshBasicMaterial color={c} toneMapped={false} />
            </mesh>
          ))}
        </group>
      );
    case "points":
      return (
        <group>
          <mesh>
            <ringGeometry args={[0.085, 0.095, 40]} />
            {gold}
          </mesh>
          <mesh>
            <shapeGeometry args={[shapes.star]} />
            {gold}
          </mesh>
        </group>
      );
    case "promo":
      return (
        <mesh>
          <shapeGeometry args={[shapes.bolt]} />
          {gold}
        </mesh>
      );
    case "coupon":
      return (
        <group rotation-z={0.25}>
          <mesh>
            <shapeGeometry args={[shapes.ticket]} />
            {gold}
          </mesh>
          <Text position={[0, -0.003, 0.002]} fontSize={0.065} color={TILE} anchorX="center" anchorY="middle">
            %
          </Text>
        </group>
      );
    case "gift":
      return (
        <group>
          <mesh position={[0, -0.03, 0]}>
            <planeGeometry args={[0.12, 0.08]} />
            {gold}
          </mesh>
          <mesh position={[0, 0.027, 0]}>
            <planeGeometry args={[0.14, 0.03]} />
            {gold}
          </mesh>
          <mesh position={[0, -0.008, 0.001]}>
            <planeGeometry args={[0.02, 0.125]} />
            <meshBasicMaterial color={TILE} />
          </mesh>
          {[-0.022, 0.022].map((x) => (
            <mesh key={x} position={[x, 0.062, 0]}>
              <ringGeometry args={[0.011, 0.021, 20]} />
              {gold}
            </mesh>
          ))}
        </group>
      );
  }
}

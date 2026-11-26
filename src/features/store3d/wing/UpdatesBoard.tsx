"use client";

/**
 * "What's new / Coming soon" display in front of the chained wing: a fixed, free-standing digital-signage wall
 * (env/extension.ts UPDATES_DISPLAY; it has a collider). Dark steel frame on a plinth, two inset screens ("On the
 * way": the rewards season, and "What's new & what's coming"), an amber edge light that breathes, a slow light sweep
 * across the glass, and a lit top cap. It stays put (no pop-up, no turning), so it never covers a shop front.
 * Pure 3D (no DOM), not pickable by the crosshair. Content: ./updates.ts.
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Text } from "@react-three/drei";
import { UPDATES_DISPLAY } from "../env/extension";
import { ON_THE_WAY, UPDATES, type UpdateIcon, type UpdateItem } from "./updates";

const W = 4.6; // main screen
const H = 2.6; // screen height
const AMBER = "#f7c416";
const MINT = "#4fd39a";
const CREAM = "#f7f4ee";
const MUTED = "#a9b5af";
const SCREEN = "#0b1210";

const ROW_H = 0.38;
const COL_X = [-W / 4 - 0.02, W / 4 + 0.02];
const TOP = 0.56; // column headings, relative to the screen centre

// Left screen ("On the way"). Its content is laid out in a frame whose origin is GAP/2 right of the screen's right
// edge (WL/WR below), as when it was a hinged wing.
const WW = 2.65;
const GAP = 0.1;
const WING_ROW_TOP = 0.5;
const WING_ROW_H = 0.37;
const WL = -GAP / 2 - WW + 0.25; // left-screen content left edge
const WR = -GAP / 2 - 0.22; // left-screen content right edge
const TILE = "#18231e";

// Display body (local frame: face looks along +z, x across, y up).
const TW = UPDATES_DISPLAY.width;
const MARGIN = (TW - WW - W - GAP) / 2; // frame border around the screens
const PLINTH_H = 0.34;
const SCREEN_Y = PLINTH_H + MARGIN + H / 2;
const FRAME_H = H + 2 * MARGIN;
const FRAME_D = 0.18;
const LEFT_X = -TW / 2 + MARGIN + WW / 2;
const MAIN_X = TW / 2 - MARGIN - W / 2;
const SCREEN_Z = FRAME_D / 2 + 0.005;

export function UpdatesBoard({ center }: { center: [number, number, number] }) {
  const edge = useRef<THREE.MeshBasicMaterial>(null);
  const sweeps = useRef<(THREE.Mesh | null)[]>([]);
  // Faces back down the hall (toward the old store, −x).
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (edge.current) edge.current.opacity = 0.75 + 0.25 * Math.sin(t * 1.6);
    // A soft light band sweeping across the glass every few seconds.
    const k = (t % 7) / 7;
    sweeps.current.forEach((m, i) => {
      if (!m) return;
      const w = i ? W : WW;
      m.position.x = -w / 2 - 0.4 + k * (w + 0.8);
      m.visible = k < 0.999;
    });
  });

  let rowIndex = 0;
  return (
    <group position={center} rotation-y={-Math.PI / 2}>
      {/* Plinth: dark steel with an amber kick line and a warm floor wash in front. */}
      <RoundedBox args={[TW + 0.1, PLINTH_H, UPDATES_DISPLAY.depth]} radius={0.04} smoothness={3} position={[0, PLINTH_H / 2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#1a1e21" roughness={0.45} metalness={0.6} />
      </RoundedBox>
      <mesh position={[0, 0.06, UPDATES_DISPLAY.depth / 2 + 0.003]}>
        <planeGeometry args={[TW - 0.2, 0.02]} />
        <meshBasicMaterial color={AMBER} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.004, UPDATES_DISPLAY.depth / 2 + 0.6]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[TW - 0.4, 1.1]} />
        <meshBasicMaterial color={AMBER} transparent opacity={0.07} depthWrite={false} toneMapped={false} />
      </mesh>

      {/* Frame: one steel body holding both screens, brushed side trims, an LED line along the top. */}
      <RoundedBox args={[TW, FRAME_H, FRAME_D]} radius={0.06} smoothness={4} position={[0, PLINTH_H + FRAME_H / 2, 0]} castShadow>
        <meshStandardMaterial color="#14181b" roughness={0.35} metalness={0.55} />
      </RoundedBox>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (TW / 2 + 0.012), PLINTH_H + FRAME_H / 2, 0]}>
          <boxGeometry args={[0.024, FRAME_H - 0.1, FRAME_D - 0.04]} />
          <meshStandardMaterial color="#c7ccd1" metalness={1} roughness={0.25} />
        </mesh>
      ))}
      <mesh position={[0, PLINTH_H + FRAME_H + 0.002, 0]}>
        <boxGeometry args={[TW - 0.3, 0.012, 0.03]} />
        <meshBasicMaterial color={AMBER} toneMapped={false} />
      </mesh>

      {/* Screens: amber edge light (breathing), glass, light sweep. */}
      {(
        [
          [LEFT_X, WW],
          [MAIN_X, W],
        ] as const
      ).map(([x, w], i) => (
        <group key={i} position={[x, SCREEN_Y, SCREEN_Z]}>
          <RoundedBox args={[w + 0.04, H + 0.04, 0.008]} radius={0.06} smoothness={3} position={[0, 0, -0.004]}>
            <meshBasicMaterial ref={i ? edge : undefined} color={AMBER} toneMapped={false} transparent opacity={0.9} />
          </RoundedBox>
          <RoundedBox args={[w, H, 0.012]} radius={0.05} smoothness={3}>
            <meshStandardMaterial color={SCREEN} roughness={0.18} metalness={0.3} />
          </RoundedBox>
          <mesh ref={(m) => { sweeps.current[i] = m; }} position={[0, 0, 0.012]} rotation-z={-0.35}>
            <planeGeometry args={[0.35, H * 1.05]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.035} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}

      {/* Main screen: what's new + coming soon. */}
      <group position={[MAIN_X, SCREEN_Y, SCREEN_Z + 0.012]}>
        <group position={[0, H / 2 - 0.34, 0]}>
          <Text position={[-W / 2 + 0.3, 0.13, 0]} fontSize={0.085} letterSpacing={0.32} color={AMBER} anchorX="left" anchorY="middle">
            WEGO SHIIIP · STORE UPDATES
          </Text>
          <Text position={[-W / 2 + 0.3, -0.07, 0]} fontSize={0.2} color={CREAM} anchorX="left" anchorY="middle">
            {"What's new & what's coming"}
          </Text>
          <mesh position={[0, -0.22, 0]}>
            <planeGeometry args={[W - 0.6, 0.006]} />
            <meshBasicMaterial color="#2f3c37" />
          </mesh>
        </group>
        {/* Column divider. */}
        <mesh position={[0, TOP - 0.95, 0]}>
          <planeGeometry args={[0.005, 1.75]} />
          <meshBasicMaterial color="#26322d" />
        </mesh>
        {(["new", "soon"] as const).map((kind, c) => (
          <group key={kind}>
            <group position={[COL_X[c]!, TOP, 0]}>
              <Pill x={-W / 4 + 0.38} label={kind === "new" ? "JUST LANDED" : "COMING SOON"} color={kind === "new" ? MINT : AMBER} />
            </group>
            {UPDATES[kind].map((item, i) => (
              <group key={item.title} position={[COL_X[c]!, TOP - 0.36 - i * ROW_H, 0]}>
                <Item item={item} accent={kind === "new" ? MINT : AMBER} />
              </group>
            ))}
          </group>
        ))}
        <Text position={[0, -H / 2 + 0.15, 0.002]} fontSize={0.062} letterSpacing={0.14} color={MUTED} anchorX="center" anchorY="middle">
          THIS WING IS CHAINED SHUT FOR NOW · CHECK BACK SOON
        </Text>
      </group>

      {/* Left screen: "On the way" (rewards season). */}
      <group position={[LEFT_X + WW / 2 + GAP / 2, SCREEN_Y, SCREEN_Z + 0.012]}>
        <group position={[0, H / 2 - 0.34, 0]}>
          <Text position={[WL, 0.13, 0]} fontSize={0.07} letterSpacing={0.3} color={AMBER} anchorX="left" anchorY="middle">
            WEGO REWARDS · SEASON 01
          </Text>
          <TagPill right={WR + 0.08} y={0.13} label="ON THE WAY" />
          <Text position={[WL, -0.07, 0]} fontSize={0.2} color={CREAM} anchorX="left" anchorY="middle">
            Play. Earn. Win.
          </Text>
          <mesh position={[(WL + WR + 0.08) / 2, -0.22, 0]}>
            <planeGeometry args={[WR + 0.08 - WL, 0.006]} />
            <meshBasicMaterial color="#2f3c37" />
          </mesh>
        </group>
        {ON_THE_WAY.map((item, i) => (
          <group key={item.title} position={[0, WING_ROW_TOP - i * WING_ROW_H, 0]}>
            <WingItem item={item} n={++rowIndex} last={i === ON_THE_WAY.length - 1} />
          </group>
        ))}
        <Text position={[-GAP / 2 - WW / 2, -H / 2 + 0.15, 0.002]} fontSize={0.058} letterSpacing={0.14} color={MUTED} anchorX="center" anchorY="middle">
          REWARDS SEASON · DETAILS SOON
        </Text>
      </group>

      {/* Back of the display (seen from the wing): plain panel with a small badge. */}
      <Text position={[0, PLINTH_H + FRAME_H / 2, -FRAME_D / 2 - 0.01]} rotation-y={Math.PI} fontSize={0.12} letterSpacing={0.4} color="#5d6661" anchorX="center" anchorY="middle">
        WEGO SHIIIP
      </Text>
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

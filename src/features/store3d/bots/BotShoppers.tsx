"use client";

/**
 * 5 demo bot shoppers (dev by default, see `botsEnabled` in ./bots). Same look as other players' avatars
 * (multiplayer/RemotePlayers) plus a little antenna and a "Bot · name" tag so nobody mistakes them for real
 * customers. One useFrame drives all of them; geometry and materials are shared; nothing here touches the
 * cart, orders, stock, prices or the network.
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { mapLive } from "../map/map-live";
import { Billboard, Text, useGLTF } from "@react-three/drei";
import { ASSETS } from "../assets/registry";
import type { Rect } from "../collision";
import type { EnvLayout } from "../env/types";
import { ARM, EYE, GEO, SHOULDER, SKIN, TROLLEY_Z } from "../multiplayer/RemotePlayers";
import { BOT_COUNT, PERSONAS, botLabel, botPose, buildBotWorld, createBots, newPose, stepBots, type Bot, type BotPose, type BotWorld, type PlayerSpot } from "./bots";

const ANTENNA = {
  stick: new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6),
  ball: new THREE.SphereGeometry(0.045, 10, 8),
  stickMat: new THREE.MeshStandardMaterial({ color: "#3a3f3c", roughness: 0.5 }),
};
const HEAD_Y = 1.42;

type TroikaText = THREE.Mesh & { text: string; sync: () => void };

interface BotRefs {
  root: THREE.Group | null;
  body: THREE.Group | null;
  armL: THREE.Group | null;
  armR: THREE.Group | null;
  cart: THREE.Group | null;
  bulb: THREE.Mesh | null;
  say: TroikaText | null;
  said: string;
}

export function BotShoppers({ env, obstacles, spawn, lowPower = false }: { env: EnvLayout; obstacles: readonly Rect[]; spawn: [number, number]; lowPower?: boolean }) {
  const { scene } = useGLTF(ASSETS.trolley.url);
  // Mutable simulation state lives in refs and is only touched inside useFrame / ref callbacks.
  const sim = useRef<{ world: BotWorld; bots: Bot[]; pose: BotPose; player: PlayerSpot } | null>(null);
  const parts = useRef<BotRefs[]>(PERSONAS.slice(0, BOT_COUNT).map(() => ({ root: null, body: null, armL: null, armR: null, cart: null, bulb: null, say: null, said: "" })));
  const looks = useMemo(
    () =>
      PERSONAS.slice(0, BOT_COUNT).map((p) => {
        const body = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.55 });
        const bulb = new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 0.8 });
        const trolley = scene.clone(true);
        trolley.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.castShadow = !lowPower && ASSETS.trolley.castShadow;
        });
        return { body, bulb, trolley };
      }),
    [scene, lowPower],
  );

  useFrame((state, delta) => {
    // Built on the first frame (grid + paths, a few ms), then only stepped.
    if (!sim.current) {
      const world = buildBotWorld(env, obstacles, spawn);
      sim.current = { world, bots: createBots(world, (Date.now() % 100000) + 1), pose: newPose(), player: { x: 0, z: 0, active: true } };
    }
    const { world, bots, pose, player } = sim.current;
    player.x = state.camera.position.x;
    player.z = state.camera.position.z;
    stepBots(bots, world, delta, player);
    // Minimap dots (same array every frame).
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i]!;
      const d = (mapLive.bots[i] ??= { x: 0, z: 0, color: b.persona.color, name: b.persona.name });
      d.x = b.motion.x;
      d.z = b.motion.z;
    }
    mapLive.bots.length = bots.length;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i]!;
      const r = parts.current[i];
      if (!r) continue;
      botPose(b, t, pose);
      if (r.root) {
        r.root.visible = true;
        r.root.position.set(b.motion.x, 0, b.motion.z);
        r.root.rotation.y = b.yaw;
      }
      if (r.body) {
        r.body.position.y = pose.lift;
        r.body.rotation.set(pose.lean, pose.turn, pose.sway, "YXZ");
      }
      const arm = ARM.tilt + (-0.25 - ARM.tilt) * pose.arms;
      const flap = pose.arms > 0.3 ? Math.sin(t * 9 + i) * 0.35 * pose.arms : 0;
      if (r.armL) r.armL.rotation.x = arm + flap;
      if (r.armR) r.armR.rotation.x = arm - flap;
      if (r.cart) {
        r.cart.rotation.z = Math.sin(t * 9 + i) * 0.012 * pose.rattle;
        r.cart.position.y = Math.abs(Math.sin(t * 17 + i)) * 0.006 * pose.rattle;
      }
      if (r.bulb) r.bulb.scale.setScalar(1 + Math.max(0, Math.sin(t * 3 + i * 1.3)) * 0.35);
      if (r.say && pose.say !== r.said) {
        r.said = pose.say;
        r.say.text = pose.say;
        r.say.visible = pose.say !== "";
        r.say.sync();
      }
    }
  });

  // Ref callbacks write into the parts table (read by useFrame).
  const bind =
    (i: number, k: Exclude<keyof BotRefs, "said">) =>
    (v: unknown) => {
      const p = parts.current[i];
      if (p) (p as unknown as Record<string, unknown>)[k] = v;
    };

  return (
    <>
      {looks.map((look, i) => {
        const persona = PERSONAS[i]!;
        return (
          <group key={persona.name} ref={bind(i, "root")} visible={false}>
            <group ref={bind(i, "body")}>
              <mesh geometry={GEO.body} material={look.body} position={[0, 0.66, 0]} castShadow={!lowPower} />
              <group position={[0, HEAD_Y, 0]}>
                <mesh geometry={GEO.head} material={SKIN} castShadow={!lowPower} />
                <mesh geometry={GEO.eye} material={EYE} position={[-0.07, 0.03, -0.18]} scale={1.5} />
                <mesh geometry={GEO.eye} material={EYE} position={[0.07, 0.03, -0.18]} scale={1.5} />
                <mesh geometry={ANTENNA.stick} material={ANTENNA.stickMat} position={[0, 0.26, 0]} />
                <mesh ref={bind(i, "bulb")} geometry={ANTENNA.ball} material={look.bulb} position={[0, 0.36, 0]} />
              </group>
              {[-0.2, 0.2].map((ax) => (
                <group key={ax} ref={bind(i, ax < 0 ? "armL" : "armR")} position={[ax, SHOULDER.y, SHOULDER.z]} rotation-x={ARM.tilt}>
                  <mesh geometry={GEO.arm} material={look.body} position={[0, (ARM.len - 0.11) / 2, 0]} scale={[1, ARM.len - 0.11, 1]} />
                </group>
              ))}
              <Billboard position={[0, 2.08, 0]}>
                <Text fontSize={0.12} color="#ffffff" outlineWidth={0.012} outlineColor="#111513" anchorX="center" anchorY="middle">
                  {botLabel(persona)}
                </Text>
                <Text position={[0, -0.11, 0]} fontSize={0.065} color="#ffc94d" outlineWidth={0.008} outlineColor="#111513" anchorX="center" anchorY="middle">
                  demo bot · not a real shopper
                </Text>
                <Text
                  ref={bind(i, "say")}
                  position={[0, 0.2, 0]}
                  fontSize={0.14}
                  color="#111513"
                  outlineWidth={0.02}
                  outlineColor="#ffffff"
                  anchorX="center"
                  anchorY="middle"
                  visible={false}
                >
                  {" "}
                </Text>
              </Billboard>
            </group>
            <group ref={bind(i, "cart")} position={[0, 0, TROLLEY_Z]}>
              <primitive object={look.trolley} scale={ASSETS.trolley.scale} rotation={ASSETS.trolley.rotation} position={ASSETS.trolley.position} />
            </group>
          </group>
        );
      })}
    </>
  );
}

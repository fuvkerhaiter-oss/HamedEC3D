"use client";

import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import { groundHeightAt, step, type Motion, type Rect, type ShopperShape } from "./collision";
import type { ControlName } from "./controls";
import { analogSpeed, touchInput } from "./input/touch-input";
import type { Vec3 } from "./layout";
import { TROLLEY } from "./trolley/geometry";
import { trolleyMotion } from "./trolley/trolley-store";
import { useStoreUi } from "./ui-store";

const WALK_SPEED = 2.2; // m/s — a little slower while pushing a trolley
const RUN_SPEED = 3.8;
const ACCELERATION = 8; // trolley has some inertia
const TURN_RESPONSE = 7; // how quickly the trolley swings to where you look
const BODY_RADIUS = 0.3;
const BODY_Y = 0.85; // body centre (shopper ~1.7 m tall standing on the floor); the trolley hangs off it
const EYE_OFFSET = 0.75; // above body centre → eyes at ~1.6 m
const JUMP_SPEED = 5.4; // m/s — natural ~0.9 m hop onto benches and low stages
const GRAVITY = 16.0; // m/s²

const SHAPE: ShopperShape = {
  radius: BODY_RADIUS,
  box: { offsetX: TROLLEY.collider.center[0], offsetZ: TROLLEY.collider.center[2], halfX: TROLLEY.collider.halfExtents[0], halfZ: TROLLEY.collider.halfExtents[2] },
};

// Reused per frame (no allocations in useFrame).
const forward = new THREE.Vector3();
const side = new THREE.Vector3();
const wish = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * First-person shopper pushing a trolley. The body yaw (and the trolley, a child of the body) smoothly
 * follows the look direction; movement is relative to the camera. Collision with walls and fixtures
 * (`obstacles`) is the small top-down solver in ./collision (flat floor, no physics engine).
 */
export function Player({ spawn, spawnYaw = 0, obstacles, trolley }: { spawn: Vec3; spawnYaw?: number; obstacles: readonly Rect[]; trolley?: ReactNode }) {
  const body = useRef<THREE.Group>(null);
  const yaw = useRef(spawnYaw);
  const motion = useRef<Motion>({ x: spawn[0], z: spawn[2], vx: 0, vz: 0 });
  const vertical = useRef({ y: 0, vy: 0 });
  const [, getKeys] = useKeyboardControls<ControlName>();
  const camera = useThree((s) => s.camera);

  // Start looking where the body/trolley faces.
  useEffect(() => {
    if (useStoreUi.getState().inspect || useStoreUi.getState().stage !== "play") return;
    camera.rotation.set(0, spawnYaw, 0, "YXZ");
  }, [camera, spawnYaw]);

  useFrame((_, delta) => {
    const b = body.current;
    if (!b || useStoreUi.getState().inspect) return;
    if (useStoreUi.getState().stage !== "play") return; // the cinematic camera owns the view (homepage embed)
    const dt = Math.min(delta, 0.1);
    const { locked, openProductId } = useStoreUi.getState();
    const keys = getKeys();

    camera.getWorldDirection(forward);
    forward.y = 0;
    const hasHeading = forward.lengthSq() > 1e-6;
    forward.normalize();
    side.crossVectors(forward, UP);

    // Trolley/body heading follows the camera with a little lag (feels like pushing a real cart).
    const fromYaw = yaw.current;
    if (hasHeading) {
      const target = Math.atan2(-forward.x, -forward.z);
      yaw.current += wrapAngle(target - yaw.current) * (1 - Math.exp(-TURN_RESPONSE * dt));
    }

    wish.set(0, 0, 0);
    if (locked && !openProductId) {
      wish.addScaledVector(forward, Number(keys.forward) - Number(keys.backward));
      wish.addScaledVector(side, Number(keys.right) - Number(keys.left));
      if (wish.lengthSq() > 0) {
        wish.normalize().multiplyScalar(keys.run ? RUN_SPEED : WALK_SPEED);
      } else if (touchInput.moveX !== 0 || touchInput.moveY !== 0) {
        // Analog joystick: direction and speed follow the thumb's displacement.
        wish.addScaledVector(forward, touchInput.moveY).addScaledVector(side, touchInput.moveX);
        const magnitude = Math.min(1, wish.length());
        if (magnitude > 0) wish.normalize().multiplyScalar(analogSpeed(magnitude, WALK_SPEED, RUN_SPEED));
      }
    }

    const m = motion.current;
    const v = vertical.current;
    const t = 1 - Math.exp(-ACCELERATION * dt);
    m.vx += (wish.x - m.vx) * t;
    m.vz += (wish.z - m.vz) * t;
    step(m, fromYaw, yaw.current, dt, SHAPE, obstacles, v.y); // moves, turns and slides along what it hits

    // Jump & gravity (Spacebar): clear low 3D props and land on top of them or the floor.
    const floorY = groundHeightAt(m.x, m.z, BODY_RADIUS, obstacles, v.y);
    const grounded = v.y <= floorY + 0.02 && v.vy <= 0;
    if (locked && !openProductId && keys.jump && grounded) {
      v.vy = JUMP_SPEED;
    }
    v.vy -= GRAVITY * dt;
    v.y += v.vy * dt;
    if (v.y <= floorY) {
      v.y = floorY;
      v.vy = 0;
    }

    // Signed speed along the trolley's facing, for wheel roll + rattle.
    trolleyMotion.speed = -Math.sin(yaw.current) * m.vx - Math.cos(yaw.current) * m.vz;

    b.position.set(m.x, BODY_Y + v.y, m.z);
    b.rotation.set(0, yaw.current, 0);
    camera.position.set(m.x, BODY_Y + v.y + EYE_OFFSET, m.z);
  });

  return (
    <group ref={body} position={[spawn[0], BODY_Y, spawn[2]]} rotation={[0, spawnYaw, 0]}>
      {trolley}
    </group>
  );
}

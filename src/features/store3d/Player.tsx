"use client";

import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import { CapsuleCollider, CuboidCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
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
const CAPSULE_HALF_HEIGHT = 0.55;
const CAPSULE_RADIUS = 0.3;
const EYE_OFFSET = 0.75; // above capsule center → eyes at ~1.6 m

// Reused per frame (no allocations in useFrame).
const forward = new THREE.Vector3();
const side = new THREE.Vector3();
const wish = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const bodyQuat = new THREE.Quaternion();

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * First-person shopper pushing a trolley. The body yaw (and the trolley + its collider, which are
 * children of the body) smoothly follows the look direction; movement is relative to the camera.
 */
export function Player({ spawn, spawnYaw = 0, trolley }: { spawn: Vec3; spawnYaw?: number; trolley?: ReactNode }) {
  const body = useRef<RapierRigidBody>(null);
  const yaw = useRef(spawnYaw);
  const [, getKeys] = useKeyboardControls<ControlName>();
  const camera = useThree((s) => s.camera);

  // Start looking where the body/trolley faces.
  useEffect(() => {
    if (useStoreUi.getState().inspect) return;
    camera.rotation.set(0, spawnYaw, 0, "YXZ");
  }, [camera, spawnYaw]);

  useFrame((_, delta) => {
    const b = body.current;
    if (!b || useStoreUi.getState().inspect) return;
    const dt = Math.min(delta, 0.1);
    const { locked, openProductId } = useStoreUi.getState();
    const keys = getKeys();

    camera.getWorldDirection(forward);
    forward.y = 0;
    const hasHeading = forward.lengthSq() > 1e-6;
    forward.normalize();
    side.crossVectors(forward, UP);

    // Trolley/body heading follows the camera with a little lag (feels like pushing a real cart).
    if (hasHeading) {
      const target = Math.atan2(-forward.x, -forward.z);
      yaw.current += wrapAngle(target - yaw.current) * (1 - Math.exp(-TURN_RESPONSE * dt));
      b.setRotation(bodyQuat.setFromAxisAngle(UP, yaw.current), true);
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

    const v = b.linvel();
    const t = 1 - Math.exp(-ACCELERATION * dt);
    const vx = v.x + (wish.x - v.x) * t;
    const vz = v.z + (wish.z - v.z) * t;
    b.setLinvel({ x: vx, y: v.y, z: vz }, true);

    // Signed speed along the trolley's facing, for wheel roll + rattle.
    trolleyMotion.speed = -Math.sin(yaw.current) * vx - Math.cos(yaw.current) * vz;

    const p = b.translation();
    camera.position.set(p.x, p.y + EYE_OFFSET, p.z);
  });

  const { center, halfExtents } = TROLLEY.collider;
  return (
    <RigidBody ref={body} colliders={false} position={spawn} rotation={[0, spawnYaw, 0]} enabledRotations={[false, false, false]} canSleep={false} ccd>
      <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} friction={0} />
      {/* Trolley body: blocks shelves/walls so the cart never passes through them. */}
      <CuboidCollider args={halfExtents} position={center} friction={0} />
      {trolley}
    </RigidBody>
  );
}

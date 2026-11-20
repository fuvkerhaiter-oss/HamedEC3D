"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { playDrop } from "../sfx";
import { basketSlot, easeInOutCubic, FLIGHT, flightPose, TROLLEY, unitJitter } from "./geometry";
import { trolleyAnchor, trolleyMotion, useTrolley, type Flight } from "./trolley-store";
import { ITEM_BOX, itemMaterial, useBasketUnits, type TrolleyCatalog } from "./visuals";

/** Items flying from the shelf into the trolley basket (world space). */
export function FlightLayer({ tc }: { tc: TrolleyCatalog }) {
  const flights = useTrolley((s) => s.flights);
  const units = useBasketUnits(tc);
  return (
    <>
      {flights.map((f) => {
        const visual = tc.visuals.get(f.productId);
        if (!visual) return null;
        const idx = units.findIndex((u) => u.key === f.key);
        return <FlyingItem key={f.key} flight={f} slotIndex={idx >= 0 ? idx : TROLLEY.maxVisibleItems - 1} visual={visual} />;
      })}
    </>
  );
}

const end = new THREE.Vector3();
const worldQ = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const camForward = new THREE.Vector3();

function FlyingItem({ flight, slotIndex, visual }: { flight: Flight; slotIndex: number; visual: { color: string; h: number; w: number } }) {
  const ref = useRef<THREE.Mesh>(null);
  const start = useRef<number | null>(null);
  const from = useRef<[number, number, number] | null>(null);
  const landed = useRef(false);

  useFrame(({ clock, camera }) => {
    const mesh = ref.current;
    const anchor = trolleyAnchor.current;
    if (!mesh || !anchor) return;

    if (start.current === null) {
      start.current = clock.elapsedTime + flight.delay;
      if (flight.from) from.current = flight.from;
      else {
        camera.getWorldDirection(camForward);
        from.current = [camera.position.x + camForward.x * 0.9, camera.position.y - 0.15, camera.position.z + camForward.z * 0.9];
      }
    }
    const t = (clock.elapsedTime - start.current) / FLIGHT.duration;
    if (t < 0) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    // Target follows the moving trolley every frame.
    const slot = basketSlot(slotIndex) ?? basketSlot(TROLLEY.maxVisibleItems - 1)!;
    const finalH = visual.h * TROLLEY.itemScale;
    anchor.localToWorld(end.set(slot[0], slot[1] + finalH / 2, slot[2]));
    anchor.getWorldQuaternion(worldQ);
    const trolleyYaw = euler.setFromQuaternion(worldQ, "YXZ").y;

    const pose = flightPose(from.current!, [end.x, end.y, end.z], t);
    const grow = t < 0.12 ? 1 + Math.sin((t / 0.12) * Math.PI) * 0.08 : 1; // little "pick-up" pop
    const s = THREE.MathUtils.lerp(1, TROLLEY.itemScale, easeInOutCubic(Math.min(1, t))) * grow;
    mesh.position.set(...pose.position);
    mesh.rotation.set(pose.tilt, trolleyYaw + unitJitter(flight.key) + pose.spin, pose.tilt * 0.5, "YXZ");
    mesh.scale.set(visual.w * s * (2 - pose.squash), visual.h * s * pose.squash, visual.w * s * (2 - pose.squash));

    if (t >= 1 && !landed.current) {
      landed.current = true;
      trolleyMotion.jiggle = Math.min(1.6, trolleyMotion.jiggle + 1);
      playDrop();
      useTrolley.getState().land(flight.key);
    }
  });

  return <mesh ref={ref} geometry={ITEM_BOX} material={itemMaterial(visual.color)} visible={false} castShadow />;
}

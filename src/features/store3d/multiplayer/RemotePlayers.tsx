"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import { remotePoses, sendPose, setListener, setVoicePosition, useNet, voiceLevel, type Member } from "./net";

const EYE_HEIGHT = 1.6; // poses are camera positions; feet are this far below
const dir = new THREE.Vector3();
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// Shared geometry for every avatar (10 shoppers ≈ 60 draw calls, no per-avatar allocations).
const GEO = {
  body: new THREE.CapsuleGeometry(0.28, 0.75, 4, 12),
  head: new THREE.SphereGeometry(0.2, 20, 14),
  eye: new THREE.SphereGeometry(0.03, 8, 6),
  ring: new THREE.TorusGeometry(0.34, 0.025, 6, 32),
};
const SKIN = new THREE.MeshStandardMaterial({ color: "#f1c9a5", roughness: 0.7 });
const EYE = new THREE.MeshBasicMaterial({ color: "#111513" });
const MIC = new THREE.MeshBasicMaterial({ color: "#3bdc7a" });

/** Other shoppers in my room + sends my own pose and moves the voice listener with the camera. */
export function RemotePlayers() {
  const members = useNet((s) => s.members);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    camera.getWorldDirection(dir);
    const { x, y, z } = camera.position;
    sendPose(x, y, z, Math.atan2(-dir.x, -dir.z), performance.now());
    setListener(x, y, z, dir.x, dir.z);
  });
  return <>{members.map((m) => <Avatar key={m.id} member={m} />)}</>;
}

function Avatar({ member }: { member: Member }) {
  const root = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const placed = useRef(false);
  const body = useMemo(() => new THREE.MeshStandardMaterial({ color: member.color, roughness: 0.55 }), [member.color]);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#3bdc7a", transparent: true, opacity: 0 }), []);

  useFrame((_, delta) => {
    const g = root.current;
    const r = remotePoses.get(member.id);
    if (!g) return;
    g.visible = !!r;
    if (!r) return;
    const [x, y, z, yaw] = r.pose;
    const feet = y - EYE_HEIGHT;
    if (!placed.current) {
      g.position.set(x, feet, z);
      g.rotation.y = yaw;
      placed.current = true;
    } else {
      const k = 1 - Math.exp(-12 * Math.min(delta, 0.1)); // smooth 10 Hz updates
      g.position.x += (x - g.position.x) * k;
      g.position.y += (feet - g.position.y) * k;
      g.position.z += (z - g.position.z) * k;
      g.rotation.y += wrap(yaw - g.rotation.y) * k;
    }
    setVoicePosition(member.id, g.position.x, g.position.y + EYE_HEIGHT, g.position.z);
    const level = voiceLevel(member.id);
    const rm = ring.current?.material as THREE.MeshBasicMaterial | undefined;
    if (rm) rm.opacity += ((level > 0.08 ? 0.9 : 0) - rm.opacity) * 0.3;
    ring.current?.scale.setScalar(1 + level * 0.4);
  });

  return (
    <group ref={root} visible={false}>
      <mesh geometry={GEO.body} material={body} position={[0, 0.66, 0]} castShadow />
      <group position={[0, 1.42, 0]}>
        <mesh geometry={GEO.head} material={SKIN} castShadow />
        <mesh geometry={GEO.eye} material={EYE} position={[-0.07, 0.03, -0.18]} />
        <mesh geometry={GEO.eye} material={EYE} position={[0.07, 0.03, -0.18]} />
      </group>
      <mesh ref={ring} geometry={GEO.ring} material={ringMat} position={[0, 0.03, 0]} rotation-x={Math.PI / 2} />
      <Billboard position={[0, 1.88, 0]}>
        <Text fontSize={0.13} color="#ffffff" outlineWidth={0.012} outlineColor="#111513" anchorX="center" anchorY="middle">
          {member.name}
        </Text>
        {/* Mic-open badge (troika's default font has no emoji). */}
        {member.mic && <mesh geometry={GEO.eye} material={MIC} position={[0, 0.15, 0]} scale={1.6} />}
      </Billboard>
    </group>
  );
}

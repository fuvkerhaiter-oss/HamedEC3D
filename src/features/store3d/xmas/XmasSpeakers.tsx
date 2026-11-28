"use client";

/**
 * Four visible ceiling-mounted 3D PA speakers in the store's corners + an 8D HRTF spatial audio source that
 * gently orbits the listener so the Christmas music wraps around the hall in 3D space (music.ts owns playback).
 * Each physical speaker features a sleek satin-black cabinet, brass bracket, and an amber/green LED woofer ring
 * that pulses subtly to the rhythm.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type { EnvLayout } from "../env/types";
import { setMusicSpeakers } from "../music";
import { XMAS_REVERB, XMAS_SPEAKER, hallImpulse, xmasSpeakerPositions } from "./hall-audio";

export function XmasSpeakers({ env, lowPower }: { env: EnvLayout; lowPower: boolean }) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const positions = useMemo(() => xmasSpeakerPositions(env.interior, env.ceilingY), [env.interior, env.ceilingY]);
  const center = useMemo(
    () => [(env.interior.min[0] + env.interior.max[0]) / 2, 1.5, (env.interior.min[2] + env.interior.max[2]) / 2] as const,
    [env.interior],
  );
  const orbitAudio = useRef<THREE.PositionalAudio | null>(null);
  const ledRefs = useRef<(THREE.Mesh | null)[]>([]);

  useEffect(() => {
    setMusicSpeakers((ctx, source) => {
      THREE.AudioContext.setContext(ctx);
      const listener = new THREE.AudioListener();
      camera.add(listener);

      const [l, r] = hallImpulse(ctx.sampleRate, lowPower ? XMAS_REVERB.lowPowerSeconds : XMAS_REVERB.seconds);
      const ir = ctx.createBuffer(2, l.length, ctx.sampleRate);
      ir.copyToChannel(l, 0);
      ir.copyToChannel(r, 1);
      const reverb = ctx.createConvolver();
      reverb.buffer = ir;
      const wet = ctx.createGain();
      wet.gain.value = XMAS_REVERB.wet;
      listener.getInput().connect(reverb).connect(wet).connect(ctx.destination);

      const group = new THREE.Group();
      group.name = "xmas-speakers";

      // 4 corner speakers (HRTF spatialized to their physical 3D corner positions)
      const speakers = positions.map(([x, y, z]) => {
        const s = new THREE.PositionalAudio(listener);
        s.panner.panningModel = "HRTF";
        s.setDistanceModel("inverse");
        s.setRefDistance(XMAS_SPEAKER.refDistance);
        s.setRolloffFactor(XMAS_SPEAKER.rolloff);
        s.setMaxDistance(XMAS_SPEAKER.maxDistance);
        s.setVolume(XMAS_SPEAKER.gain);
        s.position.set(x, y, z);
        s.setNodeSource(source);
        group.add(s);
        return s;
      });

      // 8D orbiting spatial layer that gently circles the shopper for immersive 360° presence
      const orbiter = new THREE.PositionalAudio(listener);
      orbiter.panner.panningModel = "HRTF";
      orbiter.setDistanceModel("inverse");
      orbiter.setRefDistance(4);
      orbiter.setRolloffFactor(0.6);
      orbiter.setMaxDistance(60);
      orbiter.setVolume(0.55);
      orbiter.setNodeSource(source);
      group.add(orbiter);
      orbitAudio.current = orbiter;

      scene.add(group);
      group.updateMatrixWorld(true);

      return () => {
        orbitAudio.current = null;
        for (const s of [...speakers, orbiter]) {
          s.disconnect();
          s.gain.disconnect();
        }
        scene.remove(group);
        camera.remove(listener);
        listener.getInput().disconnect();
        reverb.disconnect();
        wet.disconnect();
      };
    });
    return () => setMusicSpeakers(null);
  }, [camera, scene, positions, lowPower]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // 8D smooth circular orbit around the player camera
    if (orbitAudio.current) {
      const angle = t * 0.48;
      orbitAudio.current.position.set(
        camera.position.x + Math.cos(angle) * 5.5,
        camera.position.y + 1.2 + Math.sin(t * 0.9) * 0.6,
        camera.position.z + Math.sin(angle) * 5.5,
      );
    }
    // Subtle pulse on the visible speaker LED rings
    const pulse = 1 + Math.sin(t * 6.2) * 0.06;
    for (const m of ledRefs.current) {
      if (m) m.scale.setScalar(pulse);
    }
  });

  return (
    <group>
      {positions.map(([x, y, z], i) => {
        const yaw = Math.atan2(center[0] - x, center[2] - z);
        return (
          <group key={i} position={[x, y, z]} rotation={[0.32, yaw, 0]}>
            {/* mounting bracket */}
            <mesh position={[0, 0.32, -0.1]}>
              <cylinderGeometry args={[0.03, 0.03, 0.35, 10]} />
              <meshStandardMaterial color="#f7c416" metalness={0.75} roughness={0.25} />
            </mesh>
            {/* speaker cabinet */}
            <RoundedBox args={[0.46, 0.72, 0.38]} radius={0.04} smoothness={2}>
              <meshStandardMaterial color="#181b20" metalness={0.4} roughness={0.45} />
            </RoundedBox>
            {/* woofer cone */}
            <mesh position={[0, -0.1, 0.195]}>
              <circleGeometry args={[0.14, 24]} />
              <meshStandardMaterial color="#0b0d10" roughness={0.7} />
            </mesh>
            {/* pulsing amber LED ring */}
            <mesh
              ref={(el) => {
                ledRefs.current[i] = el;
              }}
              position={[0, -0.1, 0.198]}
            >
              <ringGeometry args={[0.135, 0.16, 28]} />
              <meshBasicMaterial color="#f7c416" toneMapped={false} />
            </mesh>
            {/* tweeter */}
            <mesh position={[0, 0.18, 0.195]}>
              <circleGeometry args={[0.06, 18]} />
              <meshStandardMaterial color="#2a2f36" metalness={0.8} roughness={0.2} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

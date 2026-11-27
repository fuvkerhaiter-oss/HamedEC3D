"use client";

import { useEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { EnvLayout } from "../env/types";
import { setMusicSpeakers } from "../music";
import { XMAS_REVERB, XMAS_SPEAKER, hallImpulse, xmasSpeakerPositions } from "./hall-audio";

/**
 * Four invisible ceiling speakers in the store's corners playing the Christmas music (music.ts owns playback).
 * All four are fed from the same Web Audio node (one media element), so they are sample-synced: no echo or phasing.
 * Gentle inverse distance + equal-power panning (cheaper than HRTF) keep the level even across the hall with a slight
 * lean toward the nearest corner; a quiet convolution reverb adds the big-hall feel. No meshes, no per-frame work of
 * our own (three.js updates the listener/panner positions in its matrix update).
 */
export function XmasSpeakers({ env, lowPower }: { env: EnvLayout; lowPower: boolean }) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const positions = xmasSpeakerPositions(env.interior, env.ceilingY);
    setMusicSpeakers((ctx, source) => {
      THREE.AudioContext.setContext(ctx); // three's listener/panners must live on the music's context
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
      const speakers = positions.map(([x, y, z]) => {
        const s = new THREE.PositionalAudio(listener);
        s.panner.panningModel = "equalpower";
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
      scene.add(group);
      group.updateMatrixWorld(true);

      return () => {
        for (const s of speakers) {
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
  }, [camera, scene, env.interior, env.ceilingY, lowPower]);

  return null;
}

/**
 * Christmas background music through four ceiling "speakers" in the store's corners (xmas/XmasSpeakers renders them,
 * music.ts owns playback, fades, mute and volume). Pure data + math (no three.js / Web Audio), shared with unit tests.
 *
 * LICENCE: the owner's commercial Christmas recording was withdrawn from the public site (moved to licensing-hold/,
 * not served) until a public performance / streaming licence exists. Until then the regular store track plays at
 * Christmas too. To use a LICENSED Christmas track: put it in public/audio/xmas/, set NEXT_PUBLIC_XMAS_MUSIC_SRC to its
 * path and record the licence in ASSET_INVENTORY.md.
 */
import type { Box } from "../env/types";

/** The Christmas track (mono 96 kbps MP3, ~2.9 MB). Fetched only when the shopper enters the store. */
export const XMAS_MUSIC_SRC = process.env.NEXT_PUBLIC_XMAS_MUSIC_SRC?.startsWith("/audio/") ? process.env.NEXT_PUBLIC_XMAS_MUSIC_SRC : "/audio/store-music.mp3";

/**
 * Speaker sound: a gentle inverse distance curve so the level stays almost even anywhere in the hall, with only a
 * slight lean toward the nearest corner. `gain` per speaker keeps the sum of the four close to a single direct source.
 */
export const XMAS_SPEAKER = {
  inset: 1.2, // m in from each wall corner
  belowCeiling: 0.35, // m
  refDistance: 14,
  rolloff: 0.35,
  maxDistance: 120,
  gain: 0.3,
} as const;

/** Hall reverb: short generated impulse, mixed in quietly. */
export const XMAS_REVERB = { seconds: 1.6, lowPowerSeconds: 0.9, preDelay: 0.018, wet: 0.16 } as const;

/** One speaker per corner of the (extended) store interior, high up under the ceiling. */
export function xmasSpeakerPositions(interior: Box, ceilingY: number): [number, number, number][] {
  const { inset, belowCeiling } = XMAS_SPEAKER;
  const x0 = interior.min[0] + inset;
  const x1 = interior.max[0] - inset;
  const z0 = interior.min[2] + inset;
  const z1 = interior.max[2] - inset;
  const y = ceilingY - belowCeiling;
  return [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
  ];
}

/** Gain of a Web Audio "inverse" distance model at distance d (same formula as PannerNode). */
export function inverseDistanceGain(d: number, ref = XMAS_SPEAKER.refDistance, rolloff = XMAS_SPEAKER.rolloff): number {
  const dd = Math.max(d, ref);
  return ref / (ref + rolloff * (dd - ref));
}

/**
 * Stereo impulse response of a medium hall: decorrelated noise in L/R with an exponential (−60 dB) decay over
 * `seconds`, a short pre-delay and a tail that gets darker as it decays (one-pole low-pass). Deterministic (seeded).
 */
export function hallImpulse(sampleRate: number, seconds: number, preDelay = XMAS_REVERB.preDelay, seed = 7): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const n = Math.max(1, Math.round(sampleRate * seconds));
  const pre = Math.min(n - 1, Math.round(sampleRate * preDelay));
  let s = seed >>> 0 || 1;
  const rand = () => {
    // xorshift32
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(n), new Float32Array(n)];
  const decay = Math.log(1000) / Math.max(1e-3, seconds - preDelay); // −60 dB at the end
  for (const ch of out) {
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sampleRate;
      const k = 0.15 + 0.75 * Math.min(1, t / seconds); // more smoothing (darker) further into the tail
      lp += (1 - k) * (rand() * 2 - 1 - lp);
      ch[i] = lp * Math.exp(-decay * t);
    }
  }
  return out;
}

/** User volume slider (0..1) → multiplier on the background level. 0.5 (default) = the designed level, 1 = 2×. */
export function volumeScale(level: number): number {
  const l = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0.5;
  return l * 2;
}

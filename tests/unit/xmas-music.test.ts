import { test } from "node:test";
import assert from "node:assert/strict";
import {
  XMAS_MUSIC_SRC,
  XMAS_SPEAKER,
  hallImpulse,
  inverseDistanceGain,
  volumeScale,
  xmasSpeakerPositions,
} from "../../src/features/store3d/xmas/hall-audio";
import { STORE_ENV } from "../../src/features/store3d/env/supermarket";

test("christmas music: one speaker per store corner, high up under the ceiling", () => {
  const { min, max } = STORE_ENV.interior;
  const pos = xmasSpeakerPositions(STORE_ENV.interior, STORE_ENV.ceilingY);
  assert.equal(pos.length, 4);
  for (const [x, y, z] of pos) {
    assert.ok(x > min[0] && x < max[0] && z > min[2] && z < max[2], "inside the store");
    assert.ok(y < STORE_ENV.ceilingY && y > STORE_ENV.ceilingY - 1, "just under the ceiling");
  }
  // Four distinct corners: two x values × two z values.
  assert.equal(new Set(pos.map((p) => p[0])).size, 2);
  assert.equal(new Set(pos.map((p) => p[2])).size, 2);
  assert.match(XMAS_MUSIC_SRC, /^\/audio\/xmas\/.+\.mp3$/);
});

test("christmas music: level stays even when walking around the store", () => {
  const pos = xmasSpeakerPositions(STORE_ENV.interior, STORE_ENV.ceilingY);
  const { min, max } = STORE_ENV.interior;
  const sum = (x: number, z: number) =>
    pos.reduce((a, [sx, sy, sz]) => a + XMAS_SPEAKER.gain * inverseDistanceGain(Math.hypot(sx - x, sy - 1.6, sz - z)), 0);
  const levels: number[] = [];
  for (let x = min[0] + 1; x < max[0]; x += 2) for (let z = min[2] + 1; z < max[2]; z += 2) levels.push(sum(x, z));
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  assert.ok(20 * Math.log10(hi / lo) < 3, `under 3 dB difference across the floor (${lo.toFixed(2)}–${hi.toFixed(2)})`);
  assert.ok(hi <= 1.1, "four speakers together are no louder than one direct source");
});

test("hall reverb impulse: stereo, decorrelated, decays to silence, deterministic", () => {
  const [l, r] = hallImpulse(48000, 1.6);
  assert.equal(l.length, 76800);
  assert.equal(r.length, l.length);
  assert.equal(l[0], 0, "pre-delay");
  const peak = (a: Float32Array, from: number, to: number) => a.subarray(from, to).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak(l, 0, 4800) > 50 * peak(l, l.length - 4800, l.length), "tail is far quieter than the start");
  assert.ok(l.every(Number.isFinite) && r.every(Number.isFinite));
  assert.notDeepEqual(l.subarray(1000, 1100), r.subarray(1000, 1100));
  assert.deepEqual(hallImpulse(48000, 1.6)[0].subarray(2000, 2050), l.subarray(2000, 2050));
});

test("music volume slider: 0.5 is the designed level, clamped 0..2×", () => {
  assert.equal(volumeScale(0.5), 1);
  assert.equal(volumeScale(0), 0);
  assert.equal(volumeScale(5), 2);
  assert.equal(volumeScale(Number.NaN), 1);
});

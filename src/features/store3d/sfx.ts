"use client";

let ctx: AudioContext | null = null;

/** Soft thud + light wire "tick" when an item lands in the trolley. Synthesized: no audio files. */
export function playDrop(): void {
  try {
    if (!ctx) {
      // Older iOS Safari only has the prefixed constructor.
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const now = ctx.currentTime;

    const thud = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thud.type = "sine";
    thud.frequency.setValueAtTime(170, now);
    thud.frequency.exponentialRampToValueAtTime(65, now + 0.12);
    thudGain.gain.setValueAtTime(0.16, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    thud.connect(thudGain).connect(ctx.destination);
    thud.start(now);
    thud.stop(now + 0.17);

    const tick = ctx.createOscillator();
    const tickGain = ctx.createGain();
    tick.type = "triangle";
    tick.frequency.setValueAtTime(2300 + Math.random() * 400, now);
    tickGain.gain.setValueAtTime(0.04, now);
    tickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    tick.connect(tickGain).connect(ctx.destination);
    tick.start(now);
    tick.stop(now + 0.1);
  } catch {
    // Audio is optional (blocked autoplay, unsupported browser).
  }
}

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Short wooden "clack" of the wheel's pointer flap hitting a peg. */
export function playWheelTick(volume = 1): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = "square";
  o.frequency.setValueAtTime(1400 + Math.random() * 200, now);
  o.frequency.exponentialRampToValueAtTime(500, now + 0.03);
  g.gain.setValueAtTime(0.05 * volume, now);
  g.gain.exponentialRampToValueAtTime(0.0008, now + 0.045);
  o.connect(g).connect(a.destination);
  o.start(now);
  o.stop(now + 0.05);
}

/** Little rising chime when the wheel stops. */
export function playWheelWin(): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  [784, 988, 1175, 1568].forEach((f, i) => {
    const t = now + i * 0.09;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.5);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + 0.52);
  });
}

"use client";

let ctx: AudioContext | null = null;

/** Soft thud + light wire "tick" when an item lands in the trolley. Synthesized: no audio files. */
export function playDrop(): void {
  try {
    ctx ??= new AudioContext();
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

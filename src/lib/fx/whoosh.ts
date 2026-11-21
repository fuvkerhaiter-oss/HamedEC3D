/**
 * Synthesized "whoosh into the store" (no audio file): filtered noise swept up and across the stereo field,
 * ending in a soft low "arrival" thump. Must be called inside a click/tap (browser autoplay rules).
 */
export function playWhoosh(volume = 0.5): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime + 0.01;
    const dur = 1.15;

    // Noise source
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    // Rising band-pass = air rushing past
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(260, t0);
    band.frequency.exponentialRampToValueAtTime(3200, t0 + 0.62);
    band.frequency.exponentialRampToValueAtTime(700, t0 + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    const pan = ctx.createStereoPanner?.();
    if (pan) {
      pan.pan.setValueAtTime(-0.7, t0);
      pan.pan.linearRampToValueAtTime(0.6, t0 + dur);
    }
    noise.connect(band).connect(gain);
    (pan ? gain.connect(pan) : gain).connect(ctx.destination);

    // Arrival thump
    const thump = ctx.createOscillator();
    const tg = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(110, t0 + 0.78);
    thump.frequency.exponentialRampToValueAtTime(42, t0 + 1.1);
    tg.gain.setValueAtTime(0.0001, t0 + 0.78);
    tg.gain.exponentialRampToValueAtTime(volume * 0.9, t0 + 0.82);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
    thump.connect(tg).connect(ctx.destination);

    noise.start(t0);
    noise.stop(t0 + dur);
    thump.start(t0 + 0.78);
    thump.stop(t0 + 1.25);
    setTimeout(() => ctx.close().catch(() => {}), 1600);
  } catch {
    /* sound is a nice-to-have */
  }
}

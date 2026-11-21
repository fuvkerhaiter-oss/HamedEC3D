"use client";

/**
 * Store background music. Starts on the "Enter" click (browsers only allow audio after a user gesture),
 * plays quieter while the pause menu / product panel is open, pauses when the tab is hidden,
 * and remembers the shopper's mute choice.
 */

const SRC = "/audio/store-music.mp3";
const VOLUME_PLAYING = 0.035; // very soft background level so shoppers clearly hear each other in voice chat
const VOLUME_DUCKED = 0.018;
const MUTE_KEY = "mm.musicMuted";

let audio: HTMLAudioElement | null = null;
/**
 * iOS ignores HTMLMediaElement.volume (always 1): fades/ducking would do nothing and the music would play
 * at full volume. There the element is routed through a Web Audio gain node instead.
 */
let gain: GainNode | null = null;
let audioCtx: AudioContext | null = null;
let started = false;
let ducked = true;
let fadeRaf = 0;
let muted = readMuted();
const listeners = new Set<() => void>();

function readMuted(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(MUTE_KEY) === "1"; // browser only (Node 26 has a warning server-side localStorage)
  } catch {
    return false;
  }
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(SRC);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
    if (audio.volume !== 0) routeThroughGain(audio); // volume is read-only (iOS)
  }
  return audio;
}

function routeThroughGain(a: HTMLAudioElement) {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    gain = audioCtx.createGain();
    gain.gain.value = 0;
    audioCtx.createMediaElementSource(a).connect(gain).connect(audioCtx.destination);
  } catch {
    gain = null; // fall back to the plain element (full volume)
  }
}

const getVolume = (a: HTMLAudioElement) => (gain ? gain.gain.value : a.volume);
const setVolume = (a: HTMLAudioElement, v: number) => {
  if (gain) gain.gain.value = v;
  else a.volume = v;
};

/** Smoothly move the volume to `to`; pauses the element when fading to silence. */
function fadeTo(to: number, ms = 600) {
  const a = getAudio();
  cancelAnimationFrame(fadeRaf);
  const from = getVolume(a);
  const t0 = performance.now();
  const step = (now: number) => {
    // rAF's timestamp is the frame start, which can be slightly before t0 → clamp k (and the volume) to [0, 1].
    const k = Math.min(1, Math.max(0, (now - t0) / ms));
    setVolume(a, Math.min(1, Math.max(0, from + (to - from) * k)));
    if (k < 1) fadeRaf = requestAnimationFrame(step);
    else if (to === 0) a.pause();
  };
  fadeRaf = requestAnimationFrame(step);
}

function targetVolume() {
  return ducked ? VOLUME_DUCKED : VOLUME_PLAYING;
}

function resume() {
  if (!started || muted || document.hidden) return;
  const a = getAudio();
  if (audioCtx?.state === "suspended") audioCtx.resume().catch(() => {});
  a.play().then(
    () => fadeTo(targetVolume(), 1200),
    () => {}, // autoplay refused; the next enter click retries
  );
}

/** Call from the "Enter the store" click handler (needs the user gesture). Safe to call repeatedly. */
export function startStoreMusic() {
  ducked = false;
  if (!started) {
    started = true;
    document.addEventListener("visibilitychange", onVisibility);
  }
  if (getAudio().paused) resume();
  else fadeTo(targetVolume());
}

/** Quieter while the shopper is in a menu, background level while walking. */
export function setMusicDucked(v: boolean) {
  ducked = v;
  if (started && !muted && audio && !audio.paused) fadeTo(targetVolume());
}

/** Leaving the store: fade out and release the listener. Music restarts on the next enter. */
export function stopStoreMusic() {
  if (!started) return;
  started = false;
  ducked = true;
  document.removeEventListener("visibilitychange", onVisibility);
  if (audio && !audio.paused) fadeTo(0, 400);
}

function onVisibility() {
  if (document.hidden) {
    if (audio && !audio.paused) fadeTo(0, 200);
  } else resume();
}

export function isMusicMuted() {
  return muted;
}

export function setMusicMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  } catch {
    // storage unavailable (private mode): the choice lasts for this visit only
  }
  if (v) {
    if (audio && !audio.paused) fadeTo(0, 300);
  } else resume();
  listeners.forEach((l) => l());
}

export function toggleMusicMuted() {
  setMusicMuted(!muted);
}

export function subscribeMusicMuted(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

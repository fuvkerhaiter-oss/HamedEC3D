"use client";

/**
 * Store background music. Starts on the "Enter" click (browsers only allow audio after a user gesture),
 * plays quieter while the pause menu / product panel is open, pauses when the tab is hidden,
 * and remembers the shopper's mute choice.
 */

const SRC = "/audio/store-music.mp3";
const VOLUME_PLAYING = 0.35;
const VOLUME_DUCKED = 0.12;
const MUTE_KEY = "mm.musicMuted";

let audio: HTMLAudioElement | null = null;
let started = false;
let ducked = true;
let fadeRaf = 0;
let muted = readMuted();
const listeners = new Set<() => void>();

function readMuted(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(MUTE_KEY) === "1";
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
  }
  return audio;
}

/** Smoothly move the volume to `to`; pauses the element when fading to silence. */
function fadeTo(to: number, ms = 600) {
  const a = getAudio();
  cancelAnimationFrame(fadeRaf);
  const from = a.volume;
  const t0 = performance.now();
  const step = (now: number) => {
    // rAF's timestamp is the frame start, which can be slightly before t0 → clamp k (and the volume) to [0, 1].
    const k = Math.min(1, Math.max(0, (now - t0) / ms));
    a.volume = Math.min(1, Math.max(0, from + (to - from) * k));
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

/** Quieter while the shopper is in a menu, full volume while walking. */
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

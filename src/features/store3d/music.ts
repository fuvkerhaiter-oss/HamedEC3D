"use client";

/**
 * Store background music. Starts on the "Enter" click (browsers only allow audio after a user gesture),
 * plays quieter while the pause menu / product panel is open, pauses when the tab is hidden,
 * and remembers the shopper's mute choice and volume.
 *
 * At Christmas (env/christmas.ts) the Christmas track plays instead, through four positional ceiling speakers in the
 * store's corners (xmas/XmasSpeakers registers them with setMusicSpeakers). Until the 3D scene is up it plays direct.
 * The file is only fetched on the first start (the Enter click), never on the home page load.
 */
import { CHRISTMAS_ON } from "./env/christmas";
import { XMAS_MUSIC_SRC, volumeScale } from "./xmas/hall-audio";

const SRC = CHRISTMAS_ON ? XMAS_MUSIC_SRC : "/audio/store-music.mp3";
const VOLUME_PLAYING = 0.035; // very soft background level so shoppers clearly hear each other in voice chat
const VOLUME_DUCKED = 0.018;
const FADE_IN_MS = CHRISTMAS_ON ? 3500 : 1200; // slow, so the music eases in under the store's sound
const MUTE_KEY = "mm.musicMuted";
const VOLUME_KEY = "mm.musicVolume";

let audio: HTMLAudioElement | null = null;
/**
 * Web Audio gain the element is routed through: always at Christmas (needed for the positional speakers), and on iOS,
 * which ignores HTMLMediaElement.volume (always 1; fades/ducking would do nothing and the music would play loud).
 */
let gain: GainNode | null = null;
let audioCtx: AudioContext | null = null;
let started = false;
let ducked = true;
let fadeRaf = 0;
let pauseTimer: ReturnType<typeof setTimeout> | undefined;
let muted = readStored(MUTE_KEY) === "1";
let level = readLevel();
const listeners = new Set<() => void>();

/** Builds the speaker graph from `source` and returns a teardown. */
export type MusicSpeakers = (ctx: AudioContext, source: AudioNode) => () => void;
let speakers: MusicSpeakers | null = null;
let detachSpeakers: (() => void) | null = null;

function readStored(key: string): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(key) : null; // browser only (Node 26 has a warning server-side localStorage)
  } catch {
    return null;
  }
}

function readLevel(): number {
  const v = Number(readStored(VOLUME_KEY) ?? "0.5");
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
}

function store(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // storage unavailable (private mode): the choice lasts for this visit only
  }
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(SRC);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
    if (CHRISTMAS_ON || audio.volume !== 0) routeThroughGain(audio); // volume is read-only (iOS)
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
    if (CHRISTMAS_ON) a.volume = 1; // level is set by the gain only
    audioCtx.createMediaElementSource(a).connect(gain);
    wireOutput();
  } catch {
    gain = null; // fall back to the plain element
    audioCtx = null;
  }
}

/** Gain → the registered speakers, or straight to the output while there are none. */
function wireOutput() {
  if (!gain || !audioCtx) return;
  detachSpeakers?.();
  detachSpeakers = null;
  gain.disconnect();
  if (speakers) {
    try {
      detachSpeakers = speakers(audioCtx, gain);
      return;
    } catch {
      gain.disconnect(); // speaker setup failed: keep the music, without the positional effect
    }
  }
  gain.connect(audioCtx.destination);
}

/**
 * The 3D scene registers its positional speakers here (null on unmount). Safe before the music starts:
 * they are wired up as soon as the audio graph exists.
 */
export function setMusicSpeakers(s: MusicSpeakers | null) {
  speakers = s;
  wireOutput();
}

const getVolume = (a: HTMLAudioElement) => (gain ? gain.gain.value : a.volume);

/** Smoothly move the volume to `to`; pauses the element when fading to silence. */
function fadeTo(to: number, ms = 600) {
  const a = getAudio();
  cancelAnimationFrame(fadeRaf);
  clearTimeout(pauseTimer);
  const target = Math.min(1, Math.max(0, to));
  if (gain && audioCtx) {
    // Scheduled on the audio clock: smooth, and keeps working in a background tab (rAF doesn't).
    const p = gain.gain;
    const now = audioCtx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(target, now + ms / 1000);
    if (target === 0) pauseTimer = setTimeout(() => a.pause(), ms + 50);
    return;
  }
  const from = getVolume(a);
  const t0 = performance.now();
  const step = (now: number) => {
    // rAF's timestamp is the frame start, which can be slightly before t0 → clamp k (and the volume) to [0, 1].
    const k = Math.min(1, Math.max(0, (now - t0) / ms));
    a.volume = Math.min(1, Math.max(0, from + (target - from) * k));
    if (k < 1) fadeRaf = requestAnimationFrame(step);
    else if (target === 0) a.pause();
  };
  fadeRaf = requestAnimationFrame(step);
}

function targetVolume() {
  return (ducked ? VOLUME_DUCKED : VOLUME_PLAYING) * volumeScale(level);
}

function resume() {
  if (!started || muted || document.hidden) return;
  const a = getAudio();
  clearTimeout(pauseTimer);
  if (audioCtx?.state === "suspended") audioCtx.resume().catch(() => {});
  if (!a.paused) {
    fadeTo(targetVolume(), FADE_IN_MS);
    return;
  }
  a.play().then(
    () => fadeTo(targetVolume(), FADE_IN_MS),
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
    // Ramp runs on the audio clock (silent within 0.2 s); the pause timer may be throttled to ~1 s in a hidden tab.
    if (audio && !audio.paused) {
      if (gain) fadeTo(0, 200);
      else audio.pause(); // element volume fades use rAF, which doesn't run in a hidden tab
    }
  } else resume();
}

export function isMusicMuted() {
  return muted;
}

export function setMusicMuted(v: boolean) {
  muted = v;
  store(MUTE_KEY, v ? "1" : "0");
  if (v) {
    if (audio && !audio.paused) fadeTo(0, 700);
  } else resume();
  listeners.forEach((l) => l());
}

export function toggleMusicMuted() {
  setMusicMuted(!muted);
}

/** Volume slider position 0..1 (0.5 = default background level). */
export function getMusicVolume() {
  return level;
}

export function setMusicVolume(v: number) {
  level = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
  store(VOLUME_KEY, String(level));
  if (started && !muted && audio && !audio.paused) fadeTo(targetVolume(), 150);
  listeners.forEach((l) => l());
}

/** Notified on mute and volume changes. */
export function subscribeMusicMuted(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

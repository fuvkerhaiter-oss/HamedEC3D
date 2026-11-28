"use client";

/**
 * Shared 3D store: auto-matched rooms of up to ROOM_CAPACITY shoppers, avatars and proximity voice chat.
 *
 * - Matchmaking + presence + WebRTC signaling: Supabase Realtime (public broadcast/presence channels with the
 *   publishable key; no tables, no secrets). Rooms are `mm-store-room-<n>`; a shopper takes the first room
 *   with a free seat (see rooms.ts `mustMoveOn`).
 * - Voice + positions: a peer-to-peer WebRTC mesh (≤ 9 peers). Audio goes through Web Audio panners so voices
 *   come from the avatar (closer = louder). Positions use an unreliable data channel; Realtime broadcast is
 *   the low-rate fallback while a peer's data channel isn't open (e.g. a strict NAT without TURN).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { create } from "zustand";
import { localChannel } from "./local-channel";
import { cleanEmote, EMOTE_DURATION_MS, type EmoteId } from "./emotes";
import { multiplayerEnabled, VOICE_CONSENT_KEY } from "./rooms";
import { BASKET_MAX, cleanAvatar, cleanBasket, cleanColor, cleanName, cleanPose, MAX_ROOMS, packBasket, mustMoveOn, packPose, randomColor, randomName, ROOM_CAPACITY, type AvatarKind, type MemberMeta, type Pose } from "./rooms";

export type NetStatus = "off" | "connecting" | "online" | "unavailable";

/** The slice of a Realtime channel this module uses (Supabase in production, local-channel.ts in dev without keys). */
export interface Chan {
  on(type: "presence" | "broadcast", filter: { event: string }, cb: (m: { payload: unknown }) => void): Chan;
  subscribe(cb: (status: string) => void): Chan;
  track(meta: Record<string, unknown>): Promise<unknown>;
  presenceState(): Record<string, Record<string, unknown>[]>;
  send(msg: { type: "broadcast"; event: string; payload: unknown }): Promise<unknown>;
  remove(): void;
}
export interface Member { id: string; name: string; color: string; avatar: AvatarKind; mic: boolean; /** Product ids in their trolley (display only). */ basket: string[] }

interface NetState {
  status: NetStatus;
  message: string | null;
  room: number | null;
  me: Member;
  /** DEV only: same-browser test room (no Supabase keys). */
  local: boolean;
  /** Other shoppers in my room (seat order). */
  members: Member[];
  micOn: boolean;
  micError: string | null;
  /** Ids of shoppers I muted. */
  muted: string[];
  /** The shopper asked to talk but has not accepted the voice notice yet (RoomHud shows it). */
  voiceConsentNeeded: boolean;
  /** Currently playing emote on my avatar (null when idle). */
  myEmote: EmoteId | null;
}

const ID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const stored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export const useNet = create<NetState>()(() => ({
  status: "off",
  message: null,
  room: null,
  me: { id: ID, name: "Shopper", color: "#2e86ab", avatar: cleanAvatar(typeof window !== "undefined" ? stored("mm-avatar") : null), mic: false, basket: [] },
  members: [],
  local: false,
  micOn: false,
  micError: null,
  muted: [],
  voiceConsentNeeded: false,
  myEmote: null,
}));

/** Latest pose per remote shopper (mutable, read every frame by the avatars; never triggers renders). */
export const remotePoses = new Map<string, { pose: Pose; at: number }>();
/** Active emote per remote shopper (mutable, read every frame by the avatars; never triggers renders). */
export const remoteEmotes = new Map<string, { emote: EmoteId; startedAt: number }>();

const ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
if (process.env.NEXT_PUBLIC_TURN_URL) {
  ICE.push({ urls: process.env.NEXT_PUBLIC_TURN_URL, username: process.env.NEXT_PUBLIC_TURN_USERNAME, credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL });
}

interface PeerAudio { el: HTMLAudioElement; src?: MediaStreamAudioSourceNode; panner?: PannerNode; gain?: GainNode; analyser?: AnalyserNode; buf?: Uint8Array<ArrayBuffer> }
interface Peer { id: string; pc: RTCPeerConnection; tx?: RTCRtpTransceiver; dc?: RTCDataChannel; ice: RTCIceCandidateInit[]; audio?: PeerAudio }

let sb: SupabaseClient | null = null;
let channel: Chan | null = null;
let localMode = false;
let roomNo = 0;
let joinedAt = 0;
let running = false;
let micTrack: MediaStreamTrack | null = null;
let voiceConsentAccepted = false;
let audioCtx: AudioContext | null = null;
let myBasket: string[] = [];
let basketTimer: ReturnType<typeof setTimeout> | null = null;
let emoteTimer: ReturnType<typeof setTimeout> | null = null;
const peers = new Map<string, Peer>();
// Dev-only handle for browser testing.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __mmNet?: unknown }).__mmNet = { peers, remotePoses };

type Signal = { to: string; from: string; kind: "offer" | "answer" | "ice"; data: unknown };

// ---------------------------------------------------------------- lifecycle

export function startMultiplayer(): void {
  if (running) return;
  if (!multiplayerEnabled()) return; // stays "off": solo shopping, no peer connections (see rooms.ts)
  running = true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const me = { id: ID, name: cleanName(stored("mm-name") ?? randomName()), color: cleanColor(stored("mm-color") ?? randomColor()), avatar: cleanAvatar(stored("mm-avatar")), mic: false, basket: myBasket };
  store("mm-name", me.name);
  store("mm-color", me.color);
  store("mm-avatar", me.avatar);
  useNet.setState({ me });
  localMode = (!url || !key) && process.env.NODE_ENV !== "production" && typeof BroadcastChannel !== "undefined";
  if (((!url || !key) && !localMode) || typeof RTCPeerConnection === "undefined") {
    useNet.setState({ status: "unavailable", message: "Shared rooms aren't available on this device or server." });
    return;
  }
  if (!localMode) {
    sb ??= createClient(url!, key!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "sb-multiplayer-auth",
      },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  useNet.setState({ local: localMode });
  joinRoom(1);
}

export function stopMultiplayer(): void {
  running = false;
  leaveRoom();
  micTrack?.stop();
  micTrack = null;
  audioCtx?.close().catch(() => {});
  audioCtx = null;
  useNet.setState({ status: "off", room: null, members: [], micOn: false });
}

function leaveRoom() {
  for (const id of [...peers.keys()]) dropPeer(id);
  remotePoses.clear();
  remoteEmotes.clear();
  channel?.remove();
  channel = null;
}

function myMeta(): Record<string, unknown> {
  const { me, micOn } = useNet.getState();
  return { id: ID, name: me.name, color: me.color, avatar: me.avatar, joinedAt, mic: micOn, basket: packBasket(myBasket) };
}

function joinRoom(n: number) {
  if ((!sb && !localMode) || !running) return;
  leaveRoom();
  if (n > MAX_ROOMS) {
    useNet.setState({ status: "unavailable", message: "The store is full right now." });
    return;
  }
  roomNo = n;
  joinedAt = Date.now();
  useNet.setState({ status: "connecting", room: null, members: [] });
  const name = `mm-store-room-${n}`;
  let ch: Chan;
  if (localMode || !sb) ch = localChannel(name, ID);
  else {
    const client = sb;
    const rc = client.channel(name, { config: { presence: { key: ID }, broadcast: { self: false } } });
    ch = Object.assign(rc, { remove: () => void client.removeChannel(rc) }) as unknown as Chan;
  }
  channel = ch;
  ch.on("presence", { event: "sync" }, () => ch === channel && onSync(ch))
    .on("broadcast", { event: "sig" }, ({ payload }) => ch === channel && onSignal(payload as Signal))
    .on("broadcast", { event: "pose" }, ({ payload }) => ch === channel && onBroadcastPose(payload as { from: string; p: unknown }))
    .on("broadcast", { event: "emote" }, ({ payload }) => ch === channel && onBroadcastEmote(payload as { from: string; e: unknown }))
    .subscribe((status) => {
      if (ch !== channel) return;
      if (status === "SUBSCRIBED") ch.track(myMeta()).catch(() => {});
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        useNet.setState({ status: "unavailable", message: "Couldn't reach the shared room. You're shopping solo." });
      }
    });
}

function onSync(ch: Chan) {
  const state = ch.presenceState() as Record<string, Partial<MemberMeta & { avatar: unknown; mic: boolean; basket: unknown }>[]>;
  const all = Object.entries(state).map(([key, metas]) => {
    const m = metas[0]!;
    return { id: key, name: cleanName(m.name), color: cleanColor(m.color), avatar: cleanAvatar(m.avatar), joinedAt: Number(m.joinedAt) || 0, mic: !!m.mic, basket: cleanBasket(m.basket) };
  });
  if (!all.some((m) => m.id === ID)) return; // my own track hasn't landed yet
  if (mustMoveOn(all, ID, ROOM_CAPACITY)) return joinRoom(roomNo + 1);
  const others = all.filter((m) => m.id !== ID).sort((a, b) => a.joinedAt - b.joinedAt);
  useNet.setState({ status: "online", message: null, room: roomNo, members: others.map(({ id, name, color, avatar, mic, basket }) => ({ id, name, color, avatar, mic, basket })) });
  const ids = new Set(others.map((m) => m.id));
  for (const id of [...peers.keys()]) if (!ids.has(id)) dropPeer(id);
  for (const id of ids) if (!peers.has(id) && ID < id) void callPeer(id); // lower id makes the offer
}

/** Rename myself (persisted). */
export function setMyName(raw: string): void {
  const name = cleanName(raw);
  store("mm-name", name);
  useNet.setState((s) => ({ me: { ...s.me, name } }));
  channel?.track(myMeta()).catch(() => {});
}

/** Switch my 3D avatar ("woman" | "man", persisted & synced). */
export function setMyAvatar(avatar: AvatarKind): void {
  const clean = cleanAvatar(avatar);
  store("mm-avatar", clean);
  useNet.setState((s) => ({ me: { ...s.me, avatar: clean } }));
  channel?.track(myMeta()).catch(() => {});
}

/** My trolley contents (product ids) for the other shoppers; debounced so a burst of adds is one presence update. */
export function setMyBasket(productIds: readonly string[]): void {
  const next = productIds.slice(0, BASKET_MAX);
  if (next.length === myBasket.length && next.every((id, i) => id === myBasket[i])) return;
  myBasket = next;
  if (basketTimer) clearTimeout(basketTimer);
  basketTimer = setTimeout(() => {
    basketTimer = null;
    channel?.track(myMeta()).catch(() => {});
  }, 350);
}

// ---------------------------------------------------------------- WebRTC

function send(sig: Omit<Signal, "from">) {
  channel?.send({ type: "broadcast", event: "sig", payload: { ...sig, from: ID } }).catch(() => {});
}

function newPeer(id: string): Peer {
  dropPeer(id);
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const peer: Peer = { id, pc, ice: [] };
  peers.set(id, peer);
  pc.onicecandidate = (e) => e.candidate && send({ to: id, kind: "ice", data: e.candidate.toJSON() });
  pc.ontrack = (e) => attachAudio(peer, e.streams[0] ?? new MediaStream([e.track]));
  pc.ondatachannel = (e) => setupDc(peer, e.channel);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState !== "failed" || peers.get(id) !== peer) return;
    // Retry once the dust settles (the offerer re-calls; the answerer waits for the new offer).
    setTimeout(() => { if (peers.get(id) === peer && ID < id && useNet.getState().members.some((m) => m.id === id)) void callPeer(id); }, 3000);
  };
  return peer;
}

function setupDc(peer: Peer, dc: RTCDataChannel) {
  peer.dc = dc;
  dc.onmessage = (e) => {
    const data = safeJson(e.data);
    if (data && typeof data === "object" && !Array.isArray(data) && "e" in data) {
      applyRemoteEmote(peer.id, (data as { e: unknown }).e);
      return;
    }
    const pose = cleanPose(data);
    if (pose) remotePoses.set(peer.id, { pose, at: performance.now() });
  };
}

async function callPeer(id: string) {
  const peer = newPeer(id);
  peer.tx = peer.pc.addTransceiver("audio", { direction: "sendrecv" });
  if (micTrack) await peer.tx.sender.replaceTrack(micTrack);
  setupDc(peer, peer.pc.createDataChannel("pose", { ordered: false, maxRetransmits: 0 }));
  await peer.pc.setLocalDescription(await peer.pc.createOffer());
  send({ to: id, kind: "offer", data: peer.pc.localDescription?.toJSON() });
}

async function onSignal(sig: Signal) {
  if (!sig || sig.to !== ID || typeof sig.from !== "string") return;
  try {
    if (sig.kind === "offer") {
      const peer = newPeer(sig.from); // a fresh offer always means a fresh connection
      await peer.pc.setRemoteDescription(sig.data as RTCSessionDescriptionInit);
      peer.tx = peer.pc.getTransceivers().find((t) => t.receiver.track?.kind === "audio") ?? peer.pc.getTransceivers()[0];
      if (peer.tx) {
        peer.tx.direction = "sendrecv"; // lets the mic start later with replaceTrack, no renegotiation
        if (micTrack) await peer.tx.sender.replaceTrack(micTrack);
      }
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      send({ to: sig.from, kind: "answer", data: peer.pc.localDescription?.toJSON() });
      await flushIce(peer);
    } else if (sig.kind === "answer") {
      const peer = peers.get(sig.from);
      if (!peer || peer.pc.signalingState !== "have-local-offer") return;
      await peer.pc.setRemoteDescription(sig.data as RTCSessionDescriptionInit);
      await flushIce(peer);
    } else if (sig.kind === "ice") {
      const peer = peers.get(sig.from);
      if (!peer) return;
      const c = sig.data as RTCIceCandidateInit;
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(c);
      else peer.ice.push(c);
    }
  } catch {
    /* a malformed or stale signal; the connection retries on failure */
  }
}

async function flushIce(peer: Peer) {
  for (const c of peer.ice.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
}

function dropPeer(id: string) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  remotePoses.delete(id);
  peer.dc?.close();
  peer.pc.close();
  const a = peer.audio;
  if (a) {
    a.el.srcObject = null;
    a.src?.disconnect();
    a.panner?.disconnect();
    a.gain?.disconnect();
  }
}

const safeJson = (s: unknown) => { try { return JSON.parse(String(s)); } catch { return null; } };

// ---------------------------------------------------------------- positions

let lastDc = 0;
let lastBroadcast = 0;
let lastSent: Pose | null = null;

/** Called every frame with the local camera pose; throttles itself (10 Hz P2P, ≤ 2.5 Hz broadcast fallback). */
export function sendPose(x: number, y: number, z: number, yaw: number, now: number): void {
  if (!channel || peers.size === 0 || now - lastDc < 100) return;
  lastDc = now;
  const pose = packPose(x, y, z, yaw);
  const msg = JSON.stringify(pose);
  let needsFallback = false;
  for (const p of peers.values()) {
    if (p.dc?.readyState === "open") p.dc.send(msg);
    else needsFallback = true;
  }
  const moved = !lastSent || pose.some((v, i) => Math.abs(v - lastSent![i]!) > 0.02);
  if (needsFallback && now - lastBroadcast > 400 && (moved || now - lastBroadcast > 2000)) {
    lastBroadcast = now;
    lastSent = pose;
    channel.send({ type: "broadcast", event: "pose", payload: { from: ID, p: pose } }).catch(() => {});
  }
}

function applyRemoteEmote(from: string, raw: unknown) {
  if (raw === null) {
    remoteEmotes.delete(from);
    return;
  }
  const emote = cleanEmote(raw);
  if (emote) remoteEmotes.set(from, { emote, startedAt: performance.now() });
}

function onBroadcastEmote(msg: { from: string; e: unknown }) {
  if (!msg || typeof msg.from !== "string" || msg.from === ID) return;
  applyRemoteEmote(msg.from, msg.e);
}

/** Trigger (or stop, if null / same emote) an emote on my avatar and broadcast it to everyone in the room. */
export function triggerEmote(emote: EmoteId | null): void {
  const cur = useNet.getState().myEmote;
  const next = emote && emote === cur ? null : emote;
  if (emoteTimer) {
    clearTimeout(emoteTimer);
    emoteTimer = null;
  }
  useNet.setState({ myEmote: next });
  if (next) {
    emoteTimer = setTimeout(() => {
      emoteTimer = null;
      useNet.setState({ myEmote: null });
    }, EMOTE_DURATION_MS);
  }
  const msg = JSON.stringify({ e: next });
  for (const p of peers.values()) {
    if (p.dc?.readyState === "open") {
      try { p.dc.send(msg); } catch { /* ignore */ }
    }
  }
  channel?.send({ type: "broadcast", event: "emote", payload: { from: ID, e: next } }).catch(() => {});
}

function onBroadcastPose(msg: { from: string; p: unknown }) {
  if (!msg || typeof msg.from !== "string" || !peers.has(msg.from)) return;
  if (peers.get(msg.from)!.dc?.readyState === "open") return; // the P2P stream is fresher
  const pose = cleanPose(msg.p);
  if (pose) remotePoses.set(msg.from, { pose, at: performance.now() });
}

// ---------------------------------------------------------------- voice

/** Call inside a click/tap: browsers (iOS especially) only start audio after a user gesture. */
export function unlockVoiceAudio(): void {
  if (!audioCtx) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    for (const p of peers.values()) if (p.audio && !p.audio.src) wireSpatial(p.id, p.audio);
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  for (const p of peers.values()) p.audio?.el.play().catch(() => {});
}

function attachAudio(peer: Peer, stream: MediaStream) {
  const el = peer.audio?.el ?? new Audio();
  el.autoplay = true;
  el.setAttribute("playsinline", "");
  el.srcObject = stream;
  peer.audio = { el };
  if (audioCtx) wireSpatial(peer.id, peer.audio);
  else el.muted = mutedPeers.has(peer.id); // no Web Audio yet: play directly (non-spatial) until unlocked
  el.play().catch(() => {});
}

function wireSpatial(id: string, a: PeerAudio) {
  if (!audioCtx || !(a.el.srcObject instanceof MediaStream)) return;
  // Chrome only feeds a remote WebRTC stream into Web Audio while a (muted) media element plays it.
  a.el.muted = true;
  a.src = audioCtx.createMediaStreamSource(a.el.srcObject);
  a.analyser = audioCtx.createAnalyser();
  a.analyser.fftSize = 256;
  a.buf = new Uint8Array(new ArrayBuffer(a.analyser.fftSize));
  a.panner = new PannerNode(audioCtx, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 2.5, maxDistance: 40, rolloffFactor: 1.1 });
  a.gain = new GainNode(audioCtx, { gain: mutedPeers.has(id) ? 0 : 1 });
  a.src.connect(a.analyser);
  a.src.connect(a.panner).connect(a.gain).connect(audioCtx.destination);
}

/** Shoppers I've muted (this visit only). Muting is local: it only silences them for me. */
const mutedPeers = new Set<string>();

export function setPeerMuted(id: string, muted: boolean): void {
  if (muted) mutedPeers.add(id);
  else mutedPeers.delete(id);
  const a = peers.get(id)?.audio;
  if (a?.gain) a.gain.gain.value = muted ? 0 : 1;
  else if (a) a.el.muted = muted;
  useNet.setState({ muted: [...mutedPeers] });
}

function setParam(p: AudioParam | undefined, v: number) {
  if (p && audioCtx) p.setTargetAtTime(v, audioCtx.currentTime, 0.05);
}

export function setListener(x: number, y: number, z: number, fx: number, fz: number): void {
  const l = audioCtx?.listener;
  if (!l) return;
  if (l.positionX) {
    setParam(l.positionX, x); setParam(l.positionY, y); setParam(l.positionZ, z);
    setParam(l.forwardX, fx); setParam(l.forwardY, 0); setParam(l.forwardZ, fz);
    setParam(l.upX, 0); setParam(l.upY, 1); setParam(l.upZ, 0);
  } else {
    l.setPosition(x, y, z);
    l.setOrientation(fx, 0, fz, 0, 1, 0);
  }
}

export function setVoicePosition(id: string, x: number, y: number, z: number): void {
  const p = peers.get(id)?.audio?.panner;
  if (!p) return;
  setParam(p.positionX, x); setParam(p.positionY, y); setParam(p.positionZ, z);
}

/** 0..1 loudness of a shopper's voice right now (drives the speaking ring). */
export function voiceLevel(id: string): number {
  const a = peers.get(id)?.audio;
  if (!a?.analyser || !a.buf) return 0;
  a.analyser.getByteTimeDomainData(a.buf);
  let sum = 0;
  for (let i = 0; i < a.buf.length; i++) { const d = (a.buf[i]! - 128) / 128; sum += d * d; }
  return Math.min(1, Math.sqrt(sum / a.buf.length) * 6);
}

function micErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone found. Connect a mic and try again.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Your microphone is busy or unavailable in another app.";
  }
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Microphone blocked. Allow it in your browser's site settings to talk.";
  }
  return "Couldn't start microphone. Check your browser settings and try again.";
}

async function openMicTrack(): Promise<MediaStreamTrack> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("no track");
    return track;
  } catch (err) {
    if (err instanceof Error && (err.name === "OverconstrainedError" || err.name === "ConstraintNotSatisfiedError")) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error("no track");
      return track;
    }
    throw err;
  }
}

export async function toggleMic(): Promise<void> {
  unlockVoiceAudio();
  if (micTrack) {
    micTrack.onended = null;
    micTrack.stop();
    micTrack = null;
    for (const p of peers.values()) await p.tx?.sender.replaceTrack(null).catch(() => {});
    useNet.setState({ micOn: false, micError: null });
  } else {
    if (!voiceConsentAccepted && stored(VOICE_CONSENT_KEY) !== "yes") {
      useNet.setState({ voiceConsentNeeded: true });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      useNet.setState({ micError: "This browser can't use a microphone here (HTTPS is required)." });
      return;
    }
    useNet.setState({ micError: null });
    try {
      const track = await openMicTrack();
      micTrack = track;
      track.onended = () => {
        if (micTrack !== track) return;
        micTrack = null;
        for (const p of peers.values()) void p.tx?.sender.replaceTrack(null).catch(() => {});
        useNet.setState({ micOn: false });
        channel?.track(myMeta()).catch(() => {});
      };
      for (const p of peers.values()) await p.tx?.sender.replaceTrack(track).catch(() => {});
      useNet.setState({ micOn: true, micError: null });
    } catch (err) {
      useNet.setState({ micError: micErrorMessage(err) });
      return;
    }
  }
  channel?.track(myMeta()).catch(() => {});
}

/** The shopper accepted the voice notice: remember it and open the microphone. */
export async function acceptVoiceNotice(): Promise<void> {
  voiceConsentAccepted = true;
  store(VOICE_CONSENT_KEY, "yes");
  useNet.setState({ voiceConsentNeeded: false });
  await toggleMic();
}

export function declineVoiceNotice(): void {
  useNet.setState({ voiceConsentNeeded: false });
}

/** Silence everyone in the room for me (local only), or undo it. */
export function setAllMuted(muted: boolean): void {
  for (const m of useNet.getState().members) setPeerMuted(m.id, muted);
}

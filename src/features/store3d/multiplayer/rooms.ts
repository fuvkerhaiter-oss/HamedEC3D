/** Pure room logic for the shared 3D store (no network, unit-tested). */

export const ROOM_CAPACITY = 10;
export const MAX_ROOMS = 200;
export const NAME_MAX = 20;

export interface MemberMeta {
  id: string;
  name: string;
  color: string;
  /** ms since epoch when this shopper joined the room; earlier joiners keep their seat. */
  joinedAt: number;
}

/** Seat order: first come, first served; id breaks ties so every client computes the same order. */
export function seatOrder(members: MemberMeta[]): MemberMeta[] {
  return [...members].sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * True when `myId` must leave this room for the next one: the room holds more than ROOM_CAPACITY
 * shoppers and I'm not among the first ROOM_CAPACITY. Two shoppers racing for the last seat both see
 * the same order, so exactly the later one moves on.
 */
export function mustMoveOn(members: MemberMeta[], myId: string, capacity = ROOM_CAPACITY): boolean {
  const idx = seatOrder(members).findIndex((m) => m.id === myId);
  return idx >= capacity;
}

const ANIMALS = ["Panda", "Koala", "Otter", "Fox", "Penguin", "Llama", "Bunny", "Tiger", "Owl", "Dolphin", "Kitten", "Puppy", "Hedgehog", "Lion", "Zebra"];
const MOODS = ["Happy", "Jolly", "Sunny", "Lucky", "Cosy", "Bouncy", "Cheery", "Snappy", "Zippy", "Merry"];
export const AVATAR_COLORS = ["#e4572e", "#2e86ab", "#f2a541", "#3bb273", "#7768ae", "#e15fa1", "#17bebb", "#c97b2a", "#5c80bc", "#9bc53d"];

export function randomName(rand = Math.random): string {
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)]!;
  return `${pick(MOODS)} ${pick(ANIMALS)}`;
}

export function randomColor(rand = Math.random): string {
  return AVATAR_COLORS[Math.floor(rand() * AVATAR_COLORS.length)]!;
}

/** Display names from other clients are untrusted: printable text only, trimmed, length-capped. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "Shopper";
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  return s || "Shopper";
}

export function cleanColor(raw: unknown): string {
  return typeof raw === "string" && /^#[0-9a-f]{6}$/i.test(raw) ? raw : AVATAR_COLORS[0]!;
}

/** Pose wire format: [x, y, z, yaw] rounded to cm / centi-radians. */
export type Pose = [number, number, number, number];
export function cleanPose(raw: unknown): Pose | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const p = raw.map(Number);
  return p.every((n) => Number.isFinite(n) && Math.abs(n) < 1000) ? (p as Pose) : null;
}
export const packPose = (x: number, y: number, z: number, yaw: number): Pose => [
  Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(z * 100) / 100, Math.round(yaw * 100) / 100,
];

/** Trolley contents shown on other shoppers: product ids only (no prices, no variants), same cap as my own basket. */
export const BASKET_MAX = 36;
export type BasketWire = [string, number][];
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Product ids in basket order → compact run-length pairs for presence. */
export function packBasket(productIds: readonly string[]): BasketWire {
  const out: BasketWire = [];
  for (const id of productIds.slice(0, BASKET_MAX)) {
    const last = out[out.length - 1];
    if (last && last[0] === id) last[1]++;
    else out.push([id, 1]);
  }
  return out;
}

/** Untrusted wire → product ids (valid ids only, counts clamped, total capped). */
export function cleanBasket(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const pair of raw.slice(0, BASKET_MAX)) {
    if (!Array.isArray(pair) || typeof pair[0] !== "string" || !PRODUCT_ID.test(pair[0])) continue;
    const n = Math.min(BASKET_MAX, Math.max(0, Math.floor(Number(pair[1]) || 0)));
    for (let i = 0; i < n && out.length < BASKET_MAX; i++) out.push(pair[0]);
  }
  return out;
}

/**
 * Shared rooms connect shoppers peer-to-peer (WebRTC), which shows each participant's IP address to the others, and
 * there is no server-side moderation yet. So they are OFF in production unless the owner turns them on on purpose
 * (NEXT_PUBLIC_MULTIPLAYER=on, after updating the privacy policy and setting up a TURN relay). On in development.
 */
export function multiplayerEnabled(flag: string | undefined = process.env.NEXT_PUBLIC_MULTIPLAYER, nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  if (flag === "on") return true;
  if (flag === "off") return false;
  return nodeEnv !== "production";
}

/** localStorage key: the shopper read and accepted the voice notice (bump the version when the notice changes). */
export const VOICE_CONSENT_KEY = "mm.voiceConsent.v1";

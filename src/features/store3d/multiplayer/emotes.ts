/**
 * Expressive multiplayer emotes for shoppers in the shared 3D store.
 * Pure data + validation (safe to share between UI, networking, and 3D avatar animation).
 */

export type EmoteId = "dance" | "wave" | "spin" | "cheer" | "dab" | "laugh";

export interface EmoteDef {
  id: EmoteId;
  key: string;
  label: string;
  /** Short ASCII label for the 3D Billboard above remote avatars (troika default font has no emoji). */
  badge: string;
}

export const EMOTES: readonly EmoteDef[] = [
  { id: "dance", key: "1", label: "Disco Dance", badge: "DANCING!" },
  { id: "wave", key: "2", label: "Big Wave", badge: "WAVING!" },
  { id: "spin", key: "3", label: "360 Spin", badge: "SPINNING!" },
  { id: "cheer", key: "4", label: "Cheer", badge: "CHEERING!" },
  { id: "dab", key: "5", label: "Dab", badge: "DAB!" },
  { id: "laugh", key: "6", label: "Laugh", badge: "HAHAHA!" },
];

export const EMOTE_DURATION_MS = 4500;

export function cleanEmote(raw: unknown): EmoteId | null {
  return typeof raw === "string" && EMOTES.some((e) => e.id === raw) ? (raw as EmoteId) : null;
}

export function emoteDef(id: EmoteId): EmoteDef {
  return EMOTES.find((e) => e.id === id) ?? EMOTES[0]!;
}

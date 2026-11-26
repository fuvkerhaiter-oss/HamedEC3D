/**
 * Look of a rental shop's door front in the 3D store: frame colour + neon lighting (colour, effect, brightness).
 * Set by the tenant in /seller/shop or by an admin on the tenant's page; stored on tenant_accounts (migration
 * 20261203000001_shop_door_style.sql). Shops without a tenant use DEFAULT_DOOR_STYLE.
 *
 * Pure (no DB, no three.js): shared by the server (validation), the editors (preview) and the 3D scene (animation).
 */
import { z } from "zod";

export const DOOR_EFFECTS = ["steady", "breathe", "chase", "rainbow", "off"] as const;
export type DoorEffect = (typeof DOOR_EFFECTS)[number];

export interface DoorStyle {
  /** Door frame, canopy and door leaves. #rrggbb */
  frame: string;
  /** Neon outline, LED lines and the glow on wall and floor. #rrggbb (ignored by "rainbow"). */
  light: string;
  effect: DoorEffect;
  /** 0–100 */
  level: number;
}

export const DEFAULT_DOOR_STYLE: DoorStyle = { frame: "#23272b", light: "#f7c416", effect: "breathe", level: 75 };

export const DOOR_EFFECT_LABELS: Record<DoorEffect, { label: string; hint: string }> = {
  steady: { label: "Steady", hint: "Always on" },
  breathe: { label: "Breathe", hint: "Slow glow in and out" },
  chase: { label: "Chase", hint: "A light runs around the door" },
  rainbow: { label: "Rainbow", hint: "Colours flow around the door" },
  off: { label: "Off", hint: "No lighting" },
};

/** Suggested frame finishes and light colours (the editors also offer a free colour picker). */
export const FRAME_SWATCHES = ["#23272b", "#0d1311", "#f4f1ea", "#b08d57", "#c8102e", "#1f4e8c", "#0f5c4a", "#6b2d5c"] as const;
export const LIGHT_SWATCHES = ["#f7c416", "#ffffff", "#ff2d7a", "#b04dff", "#21d4fd", "#2dff8c", "#ff6a00", "#ff1f1f"] as const;

const hex = z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, "Pick a colour");

/** Form input (FormData strings) → DoorStyle. */
export const DoorStyleInput = z.object({
  frame: hex,
  light: hex,
  effect: z.enum(DOOR_EFFECTS),
  level: z.coerce.number().int("Whole number").min(0).max(100),
});

/** DB row columns → DoorStyle (anything unexpected falls back to the default). */
export function doorStyleFrom(row: { door_color?: string | null; door_light_color?: string | null; door_light_effect?: string | null; door_light_level?: number | null }): DoorStyle {
  const parsed = DoorStyleInput.safeParse({
    frame: row.door_color ?? DEFAULT_DOOR_STYLE.frame,
    light: row.door_light_color ?? DEFAULT_DOOR_STYLE.light,
    effect: row.door_light_effect ?? DEFAULT_DOOR_STYLE.effect,
    level: row.door_light_level ?? DEFAULT_DOOR_STYLE.level,
  });
  return parsed.success ? parsed.data : { ...DEFAULT_DOOR_STYLE };
}

/** Brightness slider (0–100) → light multiplier: 0 is off, anything above starts visibly lit (0.3) up to 1. */
export const levelScale = (level: number): number => (level <= 0 ? 0 : 0.3 + 0.7 * Math.min(100, level) / 100);

const TAU = Math.PI * 2;

/**
 * Brightness 0–1 of a light point at position `u` (0–1 around the door: up the left side, across the top, down the
 * right side and back along the floor strip) at time `t` seconds, before the style's level is applied.
 */
export function doorLightLevel(effect: DoorEffect, t: number, u: number): number {
  switch (effect) {
    case "off":
      return 0;
    case "steady":
    case "rainbow":
      return 1;
    case "breathe":
      return 0.62 + 0.38 * Math.sin((TAU * t) / 3.2);
    case "chase": {
      // Two bright heads half a loop apart running around, on a dim base.
      const d = (((u - t * 0.32) % 0.5) + 0.5) % 0.5; // distance behind the nearest head, 0–0.5
      return 0.18 + 0.82 * Math.exp(-d * 18);
    }
  }
}

/** Hue 0–1 for "rainbow" at position u and time t. */
export const rainbowHue = (t: number, u: number): number => (((u - t * 0.12) % 1) + 1) % 1;

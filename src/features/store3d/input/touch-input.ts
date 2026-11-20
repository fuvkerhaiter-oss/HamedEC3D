/**
 * Touch input layer. The DOM touch controls write here; the existing Player / camera read it in useFrame.
 * Plain mutable module state (no React) so 60 Hz input never causes re-renders.
 */

/** Joystick displacement (fraction of knob travel) where walking tops out and sprinting begins. */
export const SPRINT_FROM = 0.85;
/** Fraction of knob travel ignored around the center (thumb jitter). */
export const JOYSTICK_DEADZONE = 0.12;
/** Look speed in radians per CSS pixel dragged, before the user's sensitivity multiplier. */
export const LOOK_RADIANS_PER_PX = 0.0055;

export const touchInput = {
  /** Analog move vector: x = strafe right, y = forward. Length 0..1. */
  moveX: 0,
  moveY: 0,
  /** Pending look delta in CSS pixels (consumed by TouchLook). */
  lookDX: 0,
  lookDY: 0,
  /** One-shot request to ease the camera pitch back to level. */
  levelView: false,
};

export function resetTouchInput() {
  touchInput.moveX = 0;
  touchInput.moveY = 0;
  touchInput.lookDX = 0;
  touchInput.lookDY = 0;
}

export interface JoystickVector {
  /** Analog output after the dead zone, length 0..1 (x right, y forward). */
  x: number;
  y: number;
  magnitude: number;
  /** Knob offset in px, clamped to the travel radius. */
  knobX: number;
  knobY: number;
}

/** Converts a finger offset from the joystick center (screen px, y down) into an analog move vector. */
export function joystickVector(dx: number, dy: number, radius: number, deadzone = JOYSTICK_DEADZONE): JoystickVector {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6 || radius <= 0) return { x: 0, y: 0, magnitude: 0, knobX: 0, knobY: 0 };
  const clamped = Math.min(len, radius);
  const ux = dx / len;
  const uy = dy / len;
  const raw = clamped / radius;
  const magnitude = raw <= deadzone ? 0 : Math.min(1, (raw - deadzone) / (1 - deadzone));
  return { x: ux * magnitude, y: -uy * magnitude, magnitude, knobX: ux * clamped, knobY: uy * clamped };
}

/** Analog speed curve: linear walk up to SPRINT_FROM, then blends into run speed at full push. */
export function analogSpeed(magnitude: number, walk: number, run: number): number {
  const m = Math.max(0, Math.min(1, magnitude));
  if (m <= SPRINT_FROM) return (walk * m) / SPRINT_FROM;
  return walk + ((run - walk) * (m - SPRINT_FROM)) / (1 - SPRINT_FROM);
}

// ---- Look sensitivity (per-device preference) ----

export const SENSITIVITY_LEVELS = [
  { id: "low", label: "Low", value: 0.65 },
  { id: "medium", label: "Medium", value: 1 },
  { id: "high", label: "High", value: 1.45 },
] as const;
export type SensitivityId = (typeof SENSITIVITY_LEVELS)[number]["id"];

const SENSITIVITY_KEY = "vsw.lookSensitivity";
let sensitivity: SensitivityId = "medium";
let sensitivityLoaded = false;

export function getSensitivity(): SensitivityId {
  if (!sensitivityLoaded && typeof window !== "undefined") {
    sensitivityLoaded = true;
    try {
      const saved = window.localStorage.getItem(SENSITIVITY_KEY);
      if (SENSITIVITY_LEVELS.some((l) => l.id === saved)) sensitivity = saved as SensitivityId;
    } catch {
      /* storage blocked: keep default */
    }
  }
  return sensitivity;
}

export function setSensitivity(id: SensitivityId) {
  sensitivity = id;
  sensitivityLoaded = true;
  try {
    window.localStorage.setItem(SENSITIVITY_KEY, id);
  } catch {
    /* storage blocked: session-only */
  }
}

export function sensitivityMultiplier(): number {
  const id = getSensitivity();
  return SENSITIVITY_LEVELS.find((l) => l.id === id)?.value ?? 1;
}

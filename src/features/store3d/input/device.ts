/** Input/device capability checks (client only). */

const mq = (q: string) => typeof window !== "undefined" && window.matchMedia(q).matches;

/** The primary pointer is a finger (phones, tablets). Used for render-quality defaults. */
export function isCoarsePrimaryPointer(): boolean {
  return mq("(pointer: coarse)");
}

/**
 * Start in touch controls when the device's primary input is touch, or when it has touch and no mouse/trackpad.
 * Hybrid devices (touch laptops, iPad + trackpad) start in desktop mode and switch on the first touch.
 */
export function prefersTouchControls(): boolean {
  if (typeof window === "undefined") return false;
  if (isCoarsePrimaryPointer()) return true;
  return navigator.maxTouchPoints > 0 && !mq("(any-pointer: fine)");
}

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

/**
 * iPhone / iPod / iPad, including iPadOS 13+ which reports itself as a Mac ("Macintosh" + touch points).
 * All iOS browsers are WebKit, which kills a WebGL tab far earlier than Android Chrome when GPU/JS memory
 * grows, so the store uses a tighter render and texture budget there.
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

/** Visitor asked the OS for less motion: no camera sway, FOV punch or bank (vestibular comfort). */
export function prefersReducedMotion(): boolean {
  return mq("(prefers-reduced-motion: reduce)");
}

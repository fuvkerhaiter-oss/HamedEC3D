"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cartCount, useCart } from "@/features/cart/cart-store";
import { interactWithTarget, openCartFromStore } from "../actions";
import { joystickVector, resetTouchInput, SPRINT_FROM, touchInput } from "../input/touch-input";
import { useStoreUi } from "../ui-store";

/** Knob travel radius (px). The base is drawn a bit larger than this. */
const TRAVEL = 52;
const BASE_SIZE = 136;
const KNOB_SIZE = 60;

const haptic = (ms = 8) => {
  try {
    // Only after a real tap (Chrome logs an error otherwise); iOS has no vibrate API.
    if (navigator.userActivation?.hasBeenActive === false) return;
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
};

/** Region where a new touch grabs the joystick (left-bottom part of the screen); everything else looks. */
function inJoystickZone(x: number, y: number) {
  return x < window.innerWidth * 0.45 && y > window.innerHeight * 0.38;
}

/**
 * Mobile control layer. Writes to the shared touch input (read by Player/TouchLook) and calls the same
 * gameplay actions as the keyboard. Multitouch: one finger on the joystick and one dragging the view
 * at the same time, plus taps on the action buttons.
 */
export function TouchControls() {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const stick = useRef<{ id: number; cx: number; cy: number } | null>(null);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);

  // Clear input when the controls hide (opening the product panel, pausing, …) so the player never drifts.
  useEffect(() => {
    const onResize = () => releaseStick();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      resetTouchInput();
    };
  }, []);

  function placeStick(dx: number, dy: number, center?: { x: number; y: number }) {
    const b = base.current;
    const k = knob.current;
    if (!b || !k) return;
    if (center) {
      // Floating joystick: the base jumps under the thumb (from its resting slot).
      const restX = b.offsetLeft + BASE_SIZE / 2;
      const restY = b.offsetTop + BASE_SIZE / 2;
      b.style.transition = "none";
      b.style.transform = `translate3d(${center.x - restX}px, ${center.y - restY}px, 0)`;
      b.dataset.active = "true";
    }
    const v = joystickVector(dx, dy, TRAVEL);
    touchInput.moveX = v.x;
    touchInput.moveY = v.y;
    k.style.transition = "none";
    k.style.transform = `translate3d(${v.knobX}px, ${v.knobY}px, 0)`;
    b.dataset.sprint = v.magnitude > SPRINT_FROM ? "true" : "false";
  }

  function releaseStick() {
    stick.current = null;
    touchInput.moveX = 0;
    touchInput.moveY = 0;
    const b = base.current;
    const k = knob.current;
    if (b) {
      b.style.transition = "transform 260ms cubic-bezier(.2,.8,.2,1), opacity 200ms";
      b.style.transform = "translate3d(0,0,0)";
      b.dataset.active = "false";
      b.dataset.sprint = "false";
    }
    if (k) {
      k.style.transition = "transform 180ms cubic-bezier(.2,.9,.3,1.3)";
      k.style.transform = "translate3d(0,0,0)";
    }
  }

  function clampCenter(x: number, y: number) {
    const m = BASE_SIZE / 2 + 8;
    return { x: Math.min(Math.max(x, m), window.innerWidth - m), y: Math.min(Math.max(y, m), window.innerHeight - m) };
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!stick.current && inJoystickZone(e.clientX, e.clientY)) {
      const c = clampCenter(e.clientX, e.clientY);
      stick.current = { id: e.pointerId, cx: c.x, cy: c.y };
      placeStick(e.clientX - c.x, e.clientY - c.y, c);
    } else if (!look.current) {
      look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    } else {
      return; // a third finger: ignore
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keep receiving moves when the finger slides over a button
    } catch {
      /* pointer already gone */
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = stick.current;
    if (s && s.id === e.pointerId) {
      placeStick(e.clientX - s.cx, e.clientY - s.cy);
      return;
    }
    const l = look.current;
    if (l && l.id === e.pointerId) {
      touchInput.lookDX += e.clientX - l.x;
      touchInput.lookDY += e.clientY - l.y;
      l.x = e.clientX;
      l.y = e.clientY;
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (stick.current?.id === e.pointerId) releaseStick();
    if (look.current?.id === e.pointerId) look.current = null;
  };

  return (
    <div className="vsw-touch">
      {/* Gesture surface: below the buttons, above the canvas. */}
      <div
        className="fixed inset-0 z-10 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onContextMenu={(e) => e.preventDefault()}
        aria-hidden
      />

      {/* Joystick (resting slot bottom-left; floats to the thumb while held). */}
      <div
        ref={base}
        data-active="false"
        data-sprint="false"
        className="vsw-stick pointer-events-none fixed z-20 flex items-center justify-center rounded-full"
        style={{
          width: BASE_SIZE,
          height: BASE_SIZE,
          left: "calc(env(safe-area-inset-left, 0px) + clamp(16px, 5vw, 40px))",
          bottom: "calc(env(safe-area-inset-bottom, 0px) + clamp(16px, 5vh, 40px))",
        }}
        aria-hidden
      >
        <div className="vsw-stick-ring absolute inset-0 rounded-full" />
        <span className="vsw-stick-arrows absolute inset-2" />
        <div ref={knob} className="vsw-stick-knob rounded-full" style={{ width: KNOB_SIZE, height: KNOB_SIZE }} />
      </div>

      <ActionButtons />

      <PauseButton />
    </div>
  );
}

/**
 * The browser still sends a click after a tap. Our buttons act on pointerdown and often unmount (a dialog
 * opens), so that click would land on whatever appeared under the finger, e.g. the cart's backdrop
 * "close" button. Eat exactly that one click.
 */
function swallowGhostClick() {
  const eat = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    cleanup();
  };
  const cleanup = () => {
    window.removeEventListener("click", eat, true);
    clearTimeout(timer);
  };
  const timer = setTimeout(cleanup, 600);
  window.addEventListener("click", eat, true);
}

/** Fires on touch/pen pointerdown (instant, works while another finger is on the joystick); click for mouse/keyboard. */
function usePress(fn: () => void) {
  const lastTouch = useRef(0);
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === "mouse") return;
      e.preventDefault();
      e.stopPropagation();
      lastTouch.current = performance.now();
      swallowGhostClick();
      fn();
    },
    onClick: () => {
      if (performance.now() - lastTouch.current < 700) return;
      fn();
    },
  };
}

function RoundButton({
  label,
  onPress,
  size = 56,
  disabled,
  highlight,
  children,
  badge,
  caption,
}: {
  label: string;
  onPress: () => void;
  size?: number;
  disabled?: boolean;
  highlight?: boolean;
  children: ReactNode;
  badge?: number;
  caption?: string;
}) {
  const press = usePress(() => {
    if (disabled) return;
    haptic();
    onPress();
  });
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        aria-label={label}
        aria-disabled={disabled || undefined}
        {...press}
        className={`vsw-btn relative flex touch-none items-center justify-center rounded-full ${highlight ? "vsw-btn-hot" : ""} ${disabled ? "opacity-45" : ""}`}
        style={{ width: size, height: size }}
      >
        {highlight && <span className="absolute inset-0 animate-ping rounded-full bg-amber/40 [animation-duration:1.6s]" aria-hidden />}
        <span className="relative">{children}</span>
        {badge !== undefined && badge > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber px-1 text-[11px] font-semibold tabular-nums text-ink">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
      {caption && <span className="pointer-events-none text-[10px] font-medium uppercase tracking-wider text-white drop-shadow">{caption}</span>}
    </div>
  );
}

function ActionButtons() {
  const target = useStoreUi((s) => s.target);
  const count = useCart((s) => cartCount(s.lines));
  const interactCaption = target ? (target.kind === "product" ? "Inspect" : target.kind === "wheel" ? "Spin" : "Checkout") : "Interact";

  return (
    <div
      className="fixed z-20 grid items-end gap-x-3 gap-y-2"
      style={{
        right: "calc(env(safe-area-inset-right, 0px) + clamp(14px, 4vw, 36px))",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + clamp(14px, 4vh, 36px))",
        gridTemplateColumns: "auto auto",
        gridTemplateAreas: '"cart cam" "interact interact"',
      }}
    >
      <div style={{ gridArea: "cart" }}>
        <RoundButton label={`Open cart, ${count} item${count === 1 ? "" : "s"}`} onPress={openCartFromStore} badge={count} caption="Cart">
          <CartIcon />
        </RoundButton>
      </div>
      <div style={{ gridArea: "cam" }}>
        <RoundButton label="Level the camera" onPress={() => (touchInput.levelView = true)} caption="Level">
          <CameraIcon />
        </RoundButton>
      </div>
      <div style={{ gridArea: "interact" }} className="justify-self-center">
        <RoundButton
          label={target ? `${interactCaption} ${target.label}` : "Interact (move closer to a product)"}
          onPress={interactWithTarget}
          size={78}
          disabled={!target}
          highlight={!!target}
          caption={interactCaption}
        >
          <HandIcon />
        </RoundButton>
      </div>
    </div>
  );
}

function PauseButton() {
  const press = usePress(() => {
    haptic();
    useStoreUi.getState().releaseLock();
  });
  return (
    <button
      type="button"
      aria-label="Pause"
      {...press}
      className="vsw-btn fixed z-20 flex h-11 w-11 touch-none items-center justify-center rounded-full"
      style={{
        left: "calc(env(safe-area-inset-left, 0px) + 14px)",
        top: "calc(env(safe-area-inset-top, 0px) + 14px)",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <rect x="3" y="2" width="3.5" height="12" rx="1" />
        <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
      </svg>
    </button>
  );
}

const iconProps = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

function CartIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2" />
      <circle cx="9.5" cy="19.5" r="1.4" />
      <circle cx="17" cy="19.5" r="1.4" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
      <path d="M2 12h20" strokeDasharray="2 2.5" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function HandIcon() {
  return (
    <svg {...iconProps} width={30} height={30}>
      <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5" />
      <path d="M14 10.5V5.5a1.5 1.5 0 0 1 3 0V12" />
      <path d="M17 11.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1.2a6 6 0 0 1-4.6-2.2L4.4 16.3a1.6 1.6 0 0 1 2.4-2.1L8 15.5" />
    </svg>
  );
}

"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useProgress } from "@react-three/drei";
import { prefersTouchControls } from "../input/device";
import { useStoreUi } from "../ui-store";
import entrance from "@/assets/loading/megamarket-entrance.webp";

const DESKTOP_TIPS = [
  "WASD to walk · Shift to run",
  "Press E to pick up a product",
  "Press C to open your cart anytime",
  "Esc pauses the store",
];
const TOUCH_TIPS = [
  "Left thumb walks · push to the edge to run",
  "Drag with your right thumb to look around",
  "Tap ✋ to pick up the product in front of you",
  "Your cart is one tap away, bottom right",
];
const noopSubscribe = () => () => {};
const touchSnapshot = () => prefersTouchControls();

/** Deterministic bokeh specks (no Math.random → no hydration mismatch). */
const SPECKS = Array.from({ length: 14 }, (_, i) => ({
  left: `${(i * 37 + 11) % 100}%`,
  size: 4 + ((i * 7) % 9),
  delay: `${-((i * 1.7) % 9).toFixed(2)}s`,
  duration: `${9 + ((i * 3) % 7)}s`,
}));

// The static screen (while the 3D bundle downloads) and the live one are separate mounts.
// Remember when the shell first appeared so the second mount continues the motion seamlessly.
let shellStartedAt: number | null = null;

/**
 * Branded loading shell: full-bleed store-front photo with a slow push-in toward the doors,
 * light sweep, floating bokeh and a glass progress card. `progress === null` → indeterminate.
 */
function LoadingShell({ progress, leaving = false }: { progress: number | null; leaving?: boolean }) {
  // Read during render: false on the server and on hydration, true only for client-side remounts.
  const [resumeMs] = useState(() => (shellStartedAt === null ? null : performance.now() - shellStartedAt));
  const [tip, setTip] = useState(0);
  // Server/hydration render uses desktop tips; the client switches to touch tips on phones/tablets.
  const TIPS = useSyncExternalStore(noopSubscribe, touchSnapshot, () => false) ? TOUCH_TIPS : DESKTOP_TIPS;

  useEffect(() => {
    shellStartedAt ??= performance.now();
    const id = window.setInterval(() => setTip((t) => (t + 1) % DESKTOP_TIPS.length), 3200);
    return () => window.clearInterval(id);
  }, []);

  const resumed = resumeMs !== null;
  const pct = progress === null ? null : Math.round(progress);

  return (
    <div
      className={`vsw-load fixed inset-0 z-40 overflow-hidden bg-ink text-cream ${leaving ? "vsw-load-leaving pointer-events-none" : ""} ${resumed ? "vsw-load-resumed" : ""}`}
      aria-hidden={leaving}
    >
      {/* Background photo with Ken Burns push-in */}
      <div className="vsw-load-bg absolute inset-0" style={resumed ? { animationDelay: `-${resumeMs}ms, 0s` } : undefined}>
        <Image src={entrance} alt="" fill priority placeholder="blur" sizes="100vw" className="object-cover object-[50%_40%]" />
      </div>

      {/* Light sweep + vignette + bottom fade for legibility */}
      <div className="vsw-load-sweep pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,transparent_45%,rgb(10_8_20/0.55)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ink/90 via-ink/45 to-transparent" />

      {/* Floating warm specks */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {SPECKS.map((s, i) => (
          <span
            key={i}
            className="vsw-speck"
            style={{ left: s.left, width: s.size, height: s.size, animationDelay: s.delay, animationDuration: s.duration }}
          />
        ))}
      </div>

      {/* Brand mark */}
      <div className="vsw-load-card absolute left-0 top-0 flex items-center gap-2.5 p-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:p-8">
        <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber font-display text-base text-ink shadow-[0_6px_20px_rgb(0_0_0/0.35)]">M</span>
        <span className="font-display text-xl leading-none drop-shadow-[0_2px_10px_rgb(0_0_0/0.6)]">
          Mega<span className="text-amber">Market</span>
        </span>
      </div>

      {/* Progress card */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="vsw-load-card w-full max-w-lg rounded-3xl border border-cream/15 bg-ink/55 p-6 shadow-[0_20px_60px_rgb(0_0_0/0.45)] backdrop-blur-xl sm:p-7">
          <p className="eyebrow flex items-center gap-2 text-cream/60">
            <span className="h-1.5 w-1.5 rounded-full bg-amber shadow-[0_0_10px_var(--color-amber)]" />
            3D Store · Now loading
          </p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <p className="font-display text-3xl leading-[1.05] sm:text-4xl">
              Opening the doors<span className="vsw-dots text-amber" aria-hidden><span>.</span><span>.</span><span>.</span></span>
            </p>
            <span className="font-display text-3xl tabular-nums leading-none text-amber sm:text-4xl">
              {pct === null ? "" : <>{pct}<span className="text-lg text-amber/70">%</span></>}
            </span>
          </div>

          <div
            className="relative mt-5 h-1.5 overflow-hidden rounded-full bg-cream/15"
            role="progressbar"
            aria-label="Loading the 3D store"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
          >
            {pct === null ? (
              <div className="vsw-bar-indeterminate absolute inset-y-0 w-1/3 rounded-full" />
            ) : (
              <div className="vsw-bar relative h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${Math.max(6, pct)}%` }} />
            )}
          </div>

          <div className="mt-4 flex items-center gap-3 border-t border-cream/10 pt-4" aria-hidden>
            <span className="eyebrow shrink-0 rounded-md bg-cream/10 px-2 py-1 !text-[10px] text-amber">Tip {tip + 1}/{TIPS.length}</span>
            <div className="relative flex h-10 flex-1 items-center overflow-hidden text-sm leading-5 text-cream/80">
              <p key={tip} className="vsw-tip line-clamp-2">{TIPS[tip]}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LoadingScreen() {
  const { progress, active } = useProgress();
  const ready = useStoreUi((s) => s.ready);
  return <LoadingShell progress={progress} leaving={ready && !active} />;
}

/** Version used while the 3D bundle itself downloads (no R3F loader yet). */
export function LoadingScreenStatic() {
  return <LoadingShell progress={null} />;
}

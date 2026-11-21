"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, useEffect, useState, type ReactNode } from "react";
import { LoadingScreenStatic } from "./hud/LoadingScreen";
import type { StoreCatalog } from "./StoreScene";

const StoreExperience = dynamic(() => import("./StoreExperience"), { ssr: false, loading: () => <LoadingScreenStatic /> });

/**
 * "ok": WebGL 2 works. "no-webgl2": only WebGL 1 (old browser/OS; three.js needs WebGL 2).
 * "webgl-off": no WebGL at all. On modern phones (every iPhone since iOS 15 has WebGL 2) this means
 * WebGL is disabled (iOS Lockdown Mode, Safari feature flag) or WebKit temporarily blocked it for the
 * page after GPU crashes.
 */
type Support = "checking" | "ok" | "no-webgl2" | "webgl-off";

/** Only success is cached; a failure may be transient (GPU process restarting), so it is re-probed. */
let supportOk = false;
const PROBE_RETRIES = 3;
const PROBE_DELAY_MS = 400;

function probe(kind: "webgl2" | "webgl"): boolean {
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    // Same attributes as the real Canvas, so the probe can't pass where the store would fail.
    gl = document.createElement("canvas").getContext(kind, { antialias: true, powerPreference: "high-performance" }) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null;
  } catch {
    gl = null;
  }
  // Free the probe context right away: iOS allows only a few live WebGL contexts and counts their memory.
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return gl !== null;
}

/** WebGL 2 available (the homepage hero only embeds the live store when this is true). */
export function canRunStore(): boolean {
  return detectSupport() === "ok";
}

function detectSupport(): Exclude<Support, "checking"> {
  if (supportOk || probe("webgl2")) {
    supportOk = true;
    return "ok";
  }
  return probe("webgl") ? "no-webgl2" : "webgl-off";
}

function isAppleMobile(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as Mac; touch points tell them apart.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function useSupport(): Support {
  const [support, setSupport] = useState<Support>("checking");
  useEffect(() => {
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      const result = detectSupport();
      if (result === "ok" || ++attempt >= PROBE_RETRIES) return setSupport(result);
      timer = setTimeout(run, PROBE_DELAY_MS);
    };
    run();
    return () => clearTimeout(timer);
  }, []);
  return support;
}

export function StoreClient({ catalog }: { catalog: StoreCatalog }) {
  const support = useSupport();

  if (support === "checking") return <LoadingScreenStatic />;
  if (support !== "ok") return <NoWebGlFallback reason={support} />;
  return (
    <StoreErrorBoundary>
      <StoreExperience catalog={catalog} />
    </StoreErrorBoundary>
  );
}

function NoWebGlFallback({ reason }: { reason: "no-webgl2" | "webgl-off" }) {
  const apple = isAppleMobile();
  const body =
    reason === "no-webgl2"
      ? apple
        ? "Your iOS version is too old for the 3D store. Update in Settings → General → Software Update, then try again. You can still shop everything from the catalog."
        : "Your browser is too old for the 3D store (it needs WebGL 2). Update your browser, then try again. You can still shop everything from the catalog."
      : apple
        ? "3D graphics (WebGL) are turned off on this device. Check that Lockdown Mode is off (Settings → Privacy & Security → Lockdown Mode) and that WebGL is on (Settings → Apps → Safari → Advanced → Feature Flags). If you just had the store open, close other tabs and reload. You can still shop everything from the catalog."
        : "3D graphics (WebGL) are turned off or blocked in this browser. Turn on hardware acceleration in your browser settings, close other heavy tabs and reload. You can still shop everything from the catalog.";
  return (
    <Fallback title="Your browser can't open the 3D store" body={body}>
      <button type="button" onClick={() => window.location.reload()} className="rounded-full border border-cream/40 px-6 py-2 text-sm">
        Try again
      </button>
    </Fallback>
  );
}

function Fallback({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink p-6 text-cream">
      <div className="max-w-md text-center">
        <h1 className="font-display text-3xl">{title}</h1>
        <p className="mt-3 text-cream/75">{body}</p>
        <div className="mt-8 flex flex-col items-center gap-4">
          <Link href="/catalog" className="rounded-full bg-amber px-7 py-3 font-medium text-ink">Open the catalog</Link>
          {children}
          <Link href="/" className="text-sm underline">Back to home</Link>
        </div>
      </div>
    </div>
  );
}

export class StoreErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error("3D store crashed", error);
  }
  override render() {
    return this.state.failed ? (
      <Fallback title="The 3D store hit a problem" body="Something went wrong while rendering the store. Your cart is safe — continue in the catalog." />
    ) : (
      this.props.children
    );
  }
}

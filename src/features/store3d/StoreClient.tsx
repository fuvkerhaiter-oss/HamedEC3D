"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, useSyncExternalStore, type ReactNode } from "react";
import { LoadingScreenStatic } from "./hud/LoadingScreen";
import type { StoreCatalog } from "./StoreScene";

const StoreExperience = dynamic(() => import("./StoreExperience"), { ssr: false, loading: () => <LoadingScreenStatic /> });

type Support = "checking" | "ok" | "no-webgl";
let cachedSupport: Support | null = null;

/** Touch devices are supported (joystick + drag-to-look); only missing WebGL 2 falls back to the catalog. */
function detectSupport(): Support {
  if (cachedSupport) return cachedSupport;
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = document.createElement("canvas").getContext("webgl2");
  } catch {
    gl = null;
  }
  cachedSupport = gl ? "ok" : "no-webgl";
  // Free the probe context right away: iOS allows only a few live WebGL contexts and counts their memory.
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return cachedSupport;
}
const noopSubscribe = () => () => {};

export function StoreClient({ catalog }: { catalog: StoreCatalog }) {
  const support = useSyncExternalStore<Support>(noopSubscribe, detectSupport, () => "checking");

  if (support === "checking") return <LoadingScreenStatic />;
  if (support === "no-webgl") {
    return (
      <Fallback title="Your browser can't open the 3D store" body="WebGL 2 isn't available on this device. You can still shop everything from the catalog." />
    );
  }
  return (
    <StoreErrorBoundary>
      <StoreExperience catalog={catalog} />
    </StoreErrorBoundary>
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

class StoreErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
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

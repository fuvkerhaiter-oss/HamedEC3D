"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { KeyboardControls, PerformanceMonitor, PointerLockControls, useGLTF } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { ASSETS } from "./assets/registry";
import { KEYMAP } from "./controls";
import { STORE_CONFIG, SUPERMARKET } from "./env/supermarket";
import { Hud } from "./hud/Hud";
import { LoadingScreen } from "./hud/LoadingScreen";
import { RotateHint } from "./hud/RotateHint";
import { isCoarsePrimaryPointer, isIOS, prefersTouchControls } from "./input/device";
import { TouchLook } from "./input/TouchLook";
import { interactionRegistry } from "./interactables";
import { Interactor } from "./Interactor";
import { PeekTracker } from "./peek/PeekTracker";
import { buildStoreLayout } from "./layout";
import { Player } from "./Player";
import { RemotePlayers } from "./multiplayer/RemotePlayers";
import { RoomHud } from "./multiplayer/RoomHud";
import { StoreScene, type StoreCatalog } from "./StoreScene";
import { FlightLayer } from "./trolley/FlightLayer";
import { Trolley } from "./trolley/Trolley";
import { useTrolley } from "./trolley/trolley-store";
import { buildTrolleyCatalog } from "./trolley/visuals";
import { LOCK_ERROR_MESSAGE, useStoreUi } from "./ui-store";

// Start downloading the imported models as soon as this bundle loads.
useGLTF.preload(ASSETS.supermarket.url);
useGLTF.preload(ASSETS.trolley.url);

/** Dev-only visual testing: /store?cam=x,y,z,yawDeg,pitchDeg fixes the camera and hides the overlay. */
function InspectCamera() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    // Dev-only handle for browser testing (touch input can't be driven by a real thumb in automation).
    (window as unknown as { __vsw?: unknown }).__vsw = { camera, ui: useStoreUi, registry: interactionRegistry };
    const cam = new URLSearchParams(window.location.search).get("cam");
    if (!cam) return;
    const [x = 0, y = 1.6, z = 0, yaw = 0, pitch = 0] = cam.split(",").map(Number);
    camera.position.set(x, y, z);
    camera.rotation.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0, "YXZ");
    useStoreUi.setState({ inspect: true });
  }, [camera]);
  return null;
}

function ContextLostNotice() {
  return (
    <div role="alertdialog" aria-labelledby="vsw-ctx-lost" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 p-6 text-center text-cream">
      <div className="max-w-sm">
        <h2 id="vsw-ctx-lost" className="font-display text-2xl">The 3D view was paused</h2>
        <p className="mt-3 text-sm text-cream/75">
          Your device ran short on graphics memory. Your cart is safe. Reload the store, or keep shopping from the catalog.
        </p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <button type="button" onClick={() => window.location.reload()} className="rounded-full bg-amber px-7 py-3 font-medium text-ink">
            Reload the store
          </button>
          <Link href="/catalog" className="text-sm underline">Open the catalog</Link>
        </div>
      </div>
    </div>
  );
}

function SceneReady() {
  useEffect(() => {
    useStoreUi.getState().setReady(true);
  }, []);
  return null;
}

export default function StoreExperience({ catalog }: { catalog: StoreCatalog }) {
  const layout = useMemo(
    () => buildStoreLayout(catalog.categories, catalog.products, SUPERMARKET, (catalog.stockAllFaces ?? STORE_CONFIG.stockAllFaces) ? "all" : STORE_CONFIG.benchmarkFaces),
    [catalog],
  );
  const trolleyCatalog = useMemo(() => buildTrolleyCatalog(catalog), [catalog]);
  const setLocked = useStoreUi((s) => s.setLocked);
  // Phones/tablets: render budget decided once at mount (GL context options can't change later).
  // iOS (all browsers there are WebKit) gets the tightest budget: Safari kills a WebGL tab at a much lower
  // memory level than Android Chrome, and iPhones report a 3× pixel ratio.
  const [ios] = useState(isIOS);
  const [lowPower] = useState(() => ios || isCoarsePrimaryPointer());
  const [maxDpr, setMaxDpr] = useState(ios ? 1.25 : lowPower ? 1.5 : 1.75);
  const contextLost = useStoreUi((s) => s.contextLost);

  useEffect(() => {
    useStoreUi.getState().setTouchMode(prefersTouchControls());
    // Browsers that don't return a Promise from requestPointerLock report refusals via this event.
    const onLockError = () => useStoreUi.getState().setLockError(LOCK_ERROR_MESSAGE);
    // Hybrid devices: the first touch switches to touch controls; a mouse click (while paused) switches back.
    const onPointerDown = (e: PointerEvent) => {
      const s = useStoreUi.getState();
      if (e.pointerType === "touch" || e.pointerType === "pen") {
        if (!s.touchMode && !s.locked) s.setTouchMode(true);
      } else if (e.pointerType === "mouse" && s.touchMode && !s.locked) {
        s.setTouchMode(false);
      }
    };
    // Touch has no Esc: pause when the app is backgrounded (call, app switch, screen off).
    const onVisibility = () => {
      const s = useStoreUi.getState();
      if (document.hidden && s.touchMode && s.locked) s.releaseLock();
    };
    // iOS Safari pinch-zoom gestures inside the game.
    const stopGesture = (e: Event) => e.preventDefault();
    document.addEventListener("pointerlockerror", onLockError);
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("gesturestart", stopGesture);
    return () => {
      document.removeEventListener("pointerlockerror", onLockError);
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("gesturestart", stopGesture);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      useStoreUi.getState().reset();
      useTrolley.getState().clear();
    };
  }, []);

  return (
    <div className="fixed inset-0 select-none overscroll-none bg-ink">
      <KeyboardControls map={KEYMAP}>
        <Canvas
          shadows
          dpr={[1, maxDpr]}
          style={{ touchAction: "none" }}
          camera={{ fov: 70, near: 0.05, far: 70, position: STORE_CONFIG.spawn }}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            // iOS drops the GL context under memory pressure / after backgrounding. three.js keeps the
            // context restorable; pause play and show a notice instead of a frozen or black screen.
            gl.domElement.addEventListener("webglcontextlost", () => {
              const s = useStoreUi.getState();
              if (s.locked) s.releaseLock();
              useStoreUi.setState({ contextLost: true });
            });
            gl.domElement.addEventListener("webglcontextrestored", () => useStoreUi.setState({ contextLost: false }));
            useStoreUi.setState({
              requestLock: () => {
                // Touch mode has no pointer lock: entering play just activates the touch controls.
                if (useStoreUi.getState().touchMode) return useStoreUi.getState().setLocked(true);
                // Some browsers reject (e.g. right after Esc, in embedded frames, or when the API is missing):
                // keep the overlay and tell the visitor instead of failing silently.
                const fail = () => useStoreUi.getState().setLockError(LOCK_ERROR_MESSAGE);
                useStoreUi.getState().setLockError(null);
                try {
                  const result = gl.domElement.requestPointerLock?.() as unknown;
                  if (!gl.domElement.requestPointerLock) fail();
                  else if (result instanceof Promise) result.catch(fail);
                } catch {
                  fail();
                }
              },
            });
          }}
        >
          {/* Mobile: drop to 1× resolution if the device can't hold its frame rate. */}
          {lowPower && <PerformanceMonitor onDecline={() => setMaxDpr(1)} flipflops={2} />}
          <color attach="background" args={["#e9e4da"]} />
          <fog attach="fog" args={["#e9e4da", 25, 60]} />
          <Suspense fallback={null}>
            <Physics timeStep="vary">
              <StoreScene env={SUPERMARKET} layout={layout} catalog={catalog} lowPower={lowPower} />
              <Player spawn={STORE_CONFIG.spawn} spawnYaw={STORE_CONFIG.spawnYaw} trolley={<Trolley tc={trolleyCatalog} />} />
            </Physics>
            <RemotePlayers />
            <FlightLayer tc={trolleyCatalog} />
            <Interactor />
            <PeekTracker />
            <TouchLook />
            <InspectCamera />
            <SceneReady />
          </Suspense>
          {/* Selector matches nothing on purpose: locking is triggered only by our own buttons. */}
          <PointerLockControls selector="#vsw-no-auto-lock" onLock={() => setLocked(true)} onUnlock={() => setLocked(false)} />
        </Canvas>
      </KeyboardControls>
      <Hud catalog={catalog} />
      <RoomHud />
      <LoadingScreen />
      <RotateHint />
      {contextLost && <ContextLostNotice />}
    </div>
  );
}

# 3D Patterns & Checklists

## Performance checklist
- Draw calls: `<Instances>`/`InstancedMesh` for repeated products & shelves; merge static geometry; share materials.
- Check `gl.info.render.calls` / `r3f-perf` (dev only) before and after changes.
- Textures: KTX2/Basis, power-of-two, max 2048 (1024 for small props), mipmaps on.
- Geometry: Draco/Meshopt compressed GLBs; LOD (`<Detailed>`) for distant shelves.
- Lighting: few dynamic lights; bake where possible; shadows only on key casters, small shadow maps.
- `frameloop="demand"` for static views; `<AdaptiveDpr>`, `<PerformanceMonitor>` to scale quality.
- Lazy load sections with `<Suspense>` + `useGLTF.preload`; dispose unused resources.
- No `new Vector3()` etc. inside `useFrame` — reuse module-level temps.

## Controller pattern
```
useFrame((_, dt) => {
  read input → dir (camera-yaw relative, normalized)
  body.setLinvel({ x: dir.x*speed, y: body.linvel().y, z: dir.z*speed })
  rotate mesh toward dir (slerp by 1 - exp(-k*dt))
})
```
- Capsule collider, `lockRotations`, ground ray for jump/grounded.

## Camera pattern (first-person)
- drei `<PointerLockControls>`; copy capsule position + eye offset (~1.65 m) to camera each frame after physics.
- Movement direction from camera yaw only (ignore pitch).
- Clamp pitch to ±85°; release lock on Esc / when a UI panel opens.

## Interaction
- Raycast from camera center (crosshair); highlight via outline/emissive; action on key/click; show product info UI outside the canvas (HTML overlay).

## Test checklist
- Walk all aisles; no clipping through shelves/walls.
- Camera never clips into shelves; no jitter at low/high FPS; pointer lock enters/exits cleanly.
- Interact with several products; UI opens/closes correctly.
- Resize window, tab away/back, pointer-lock exit.
- Chrome, Firefox, Safari/Edge; one mobile device or emulation.
- Console clean; FPS and draw calls recorded in `PROJECT_STATUS.md` if changed.

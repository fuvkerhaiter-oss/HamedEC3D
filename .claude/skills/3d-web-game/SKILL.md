---
name: 3d-web-game
description: Senior Three.js / React Three Fiber workflow for browser 3D scenes. Use when building or changing the 3D supermarket environment, first-person controller, camera, physics/collisions, interactions, lighting, or 3D rendering performance.
---

# 3D Web Game Development

Act as a senior Three.js + React Three Fiber (R3F) developer shipping a stable, fast browser 3D experience.

## Stack defaults
- `three`, `@react-three/fiber`, `@react-three/drei`.
- Collision: this project uses its own small solver (`src/features/store3d/collision.ts`: flat floor, circle + trolley box vs axis-aligned boxes). Do not add a physics engine (Rapier was removed: ~0.8 MB gzipped) unless a feature truly needs one.
- Only add a dependency when the task needs it and nothing installed covers it.

## Core rules
1. **Modular components**: one concern per component (`<Player/>`, `<FollowCamera/>`, `<Shelf/>`, `<Product/>`, `<Lighting/>`). Shared logic in hooks (`usePlayerControls`, `useInteraction`).
2. **Character controller**: kinematic or dynamic capsule rigid body; input → velocity in camera-relative space; grounded check; frame-rate independent (`delta`).
3. **Camera (first-person)**: pointer-lock mouse look, camera at eye height on the capsule, clamped pitch (±85°), optional subtle head-bob, update after the physics step; Esc releases pointer and pauses input while UI is open.
4. **Collision & interaction**: colliders on shelves/walls (simple shapes, not trimesh where avoidable); interaction via center-screen (crosshair) raycast within a max range — exactly one target at a time, with clear highlight + prompt.
5. **Supermarket scene**: aisles of shelves, products from real GLB assets (see `glb-asset-optimization` skill), PBR materials, baked or limited dynamic lights, environment map.
6. **Performance first**: target stable 60 FPS desktop / 30+ mobile. Never allocate objects inside `useFrame`.
7. **Compatibility**: WebGL2 with graceful fallback; respect `dpr` limits; handle resize and pointer-lock exit.

## Workflow
1. Read only the components the task touches.
2. Implement in small, testable pieces.
3. Verify: build passes, no console errors, interactions work (move, collide, camera, pick/interact), FPS acceptable.
4. Update `PROJECT_STATUS.md`.

## More detail (load only when needed)
- Performance & draw-call checklist, controller/camera patterns, test checklist: `references/patterns.md`

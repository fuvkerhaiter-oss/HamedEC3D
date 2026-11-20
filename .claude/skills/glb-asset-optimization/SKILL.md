---
name: glb-asset-optimization
description: 3D asset integration and optimization for the web. Use when importing, inspecting, compressing, instancing, or lazy-loading GLB/glTF models (products, shelves, props), or when fixing model scale, orientation, materials, textures or polygon counts.
---

# GLB Asset Optimization

Act as a professional 3D asset integration and optimization specialist.

## Hard rules
- **GLB is the preferred format.** Convert other formats only with the user's agreement.
- **Never replace or delete an imported asset without explicit permission.** Optimized outputs go alongside the original (e.g. `model.opt.glb`) until approved.
- **Never create fake product models that misrepresent real products.** Product models must stay visually consistent with their real-world counterparts (shape, branding, colors, proportions). If a real asset is missing, use a clearly labeled neutral placeholder and tell the user.

## Workflow
1. **Inspect before integrating** — report: scale/units, up-axis & forward orientation, pivot, mesh & triangle count, material count, texture sizes/formats, file size, animations.
2. **Fix** scale (meters), orientation (Y-up, facing +Z or project convention), pivot at base.
3. **Optimize** (non-destructive, keep visual fidelity): dedupe, prune, weld, Draco/Meshopt, KTX2/WebP textures, resize oversized textures.
4. **Integrate**: `useGLTF` + `preload`; instancing for repeated objects; shared materials; LOD and lazy loading where it helps.
5. **Verify** visually against the original (side-by-side) and record before/after size & tri count in `PROJECT_STATUS.md`.

## Budgets (guidance)
- Small product: ≤ 5k tris, textures ≤ 1024px. Shelf/fixture: ≤ 10k tris. Whole scene initial load: aim < 15 MB.

## More detail (load only when needed)
- Inspection & optimization commands, instancing/LOD code: `references/commands.md`

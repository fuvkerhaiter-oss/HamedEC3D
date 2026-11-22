# Asset Inventory

Source folder: `3D models/` (originals — never modified or deleted). Optimized copies used by the app: `public/models/`.
Build scripts: `tools/assets/` (Python 3 + numpy + Pillow). Registry: `src/features/store3d/assets/registry.ts`.
Audited 2026-11-20 (structure, bounds, materials, textures, triangle counts, orthographic + first-person renders).

## Web-optimized copies (2026-11-21, Phase 3)
`node tools/assets/optimize-glb.mjs <in> <out> [--simplify=r] [--error=e] [--webp=q]` → meshopt compression (EXT_meshopt_compression + KHR_mesh_quantization), WebP textures (EXT_texture_webp), optional simplification. Used by the app (registry):
| File | Before | After | Tris |
|---|---|---|---|
| `public/models/env/supermarket.opt.glb` | 12.6 MB | 2.3 MB | 211k (unchanged) |
| `public/models/props/trolley.opt.glb` | 9.5 MB | 0.8 MB | 163k → 32.5k (`--simplify=0.2 --error=0.004`) |
| `public/models/props/chain.opt.glb` | 9.6 MB FBX + 13 MB PNGs | 0.3 MB | 11k → 2.2k (`--simplify=0.2 --error=0.01 --webp=85`) |
Previous copies (`supermarket.glb`, `trolley.glb`) are kept until deletion is approved.

**Iron chain** (`3D models/Meshy_AI_Iron_Chain_0927192851_texture.fbx` + base/normal/metallic/roughness PNGs, 2048²; Meshy AI export from the owner): `node tools/assets/fbx-to-glb.mjs <fbx> <tmp.glb> --base=… --normal=… --metallic=… --roughness=… --tex=1024` (FBX → GLB, long axis → +X, 1 m long, textures 1024², metal+rough packed) then `optimize-glb.mjs`. Used as a tiled, instanced segment for the chained-off portal of the new wing.

**Runtime change to supermarket.opt.glb** (file untouched): at load, `env/reshape.ts` drops the old far wall (triangles entirely at x ≥ 14.1) and moves the two fridge banks that stood against it onto the side walls of the new hall (see `env/extension.ts`).

## Summary

| File | Size | Tris | Units / orientation | Purpose | Decision |
|---|---|---|---|---|---|
| `super_market_for_free.glb` | 26.9 MB | 388k (3,598 meshes) | meters, Y-up | Full supermarket: building, 6 gondola runs, wall racks, chest freezers, checkout, entrance trolleys/baskets | **Used** → `public/models/env/supermarket.glb` |
| `cart_basket.glb` | 16.4 MB | 163k | **centimeters**, Y-up, front = +Z | Realistic wire shopping trolley | **Used** → `public/models/props/trolley.glb` |
| `LPG_Lite.glb` | 1.5 MB | 20k | meters, Y-up | Low-poly kit: walls, floor tiles, door, window, pillar, gondola, fridge, counter, register, basket, mop bucket, wet-floor sign | **Not used yet** (style mismatch) |
| `mini_market.glb` | 45.3 MB | 1,016k | meters, Y-up | Small kiosk with branded products | **Excluded** |

## super_market_for_free.glb → `public/models/env/supermarket.glb` (12.6 MB, 211k tris, 19 meshes)

- **Contents:** store shell (floor, walls, ceiling, roof trusses), 6 double-sided gondola runs (6.52 × 2.35 × 1.085 m; boards at 0.46 / 0.94 / 1.41 / 1.89 m; 3 bays each), back-wall racks, chest freezers (front and back), right-wall shelving, checkout counter, trolley corral + red baskets at the entrance, 2 loose trolleys.
- **Issues found**
  - A showcase grid floats ~20 m above the store (23 × 13 m backdrop plane + 140 sample items) → removed.
  - Shelves/fridges are pre-stocked with ~3,260 generic sample products (9 texture atlases) → removed. They are not our products; showing unbuyable goods would mislead customers. Real catalog products are placed at runtime.
  - 3,598 separate meshes (≈3,600 draw calls) → merged per material into 19 meshes.
  - No missing or broken texture references. 2 alpha-blended materials (glass) preserved.
- **Optimization:** transforms baked, geometry merged by material, textures ≤ 1024 px.
- **Measured layout:** `src/features/store3d/env/supermarket.layout.json` — interior bounds, 4 wall + 18 fixture colliders, 6 runs, 12 shelf faces, checkout zone.
- **Registry:** scale 1, no rotation; receives shadows only (performance).

## cart_basket.glb → `public/models/props/trolley.glb` (9.5 MB, 163k tris)

- **Issues found**
  - Requires `KHR_materials_pbrSpecularGlossiness`, which three.js no longer supports → converted to metallic-roughness (Khronos/Babylon conversion). Base color and metalness come from the specular map (chrome), roughness from gloss. Normal and AO maps are kept.
  - Authored in centimeters (103 cm tall) with the front at +Z.
  - Textures 4 × 2048 px (9.4 MB) → 1024 px.
- **Registry:** scale 0.01, yaw 180° (front = −Z), casts shadows.
- **Measured basket:** wire floor y 0.435–0.49 m (sloped, higher at the front), z −0.42…+0.24, half-width 0.18 → `trolley/geometry.ts`.
- **Note:** wheels are part of one mesh, so there is no wheel-spin animation; the trolley rattles while rolling instead.

## LPG_Lite.glb — not used yet

Modular low-poly kit with one 256 px atlas texture. Its flat, stylized look doesn't match the textured supermarket model. Candidate uses if needed: `LPG_Prop_WetSign_A_01` or `LPG_Prop_MopBucket_A_01` as decor, `LPG_Prop_Basket_A_01` as hand baskets. Pieces are 1:1 meters; each node is offset along X in the file, so use the node geometry, not the node position.

## mini_market.glb — excluded

- 1.0 M triangles and 45 MB for a 5.5 × 8 m kiosk: too heavy for the browser.
- Contains real branded products (materials named by EAN barcodes), a stock-photo backdrop and a photo cut-out of a real person.
- It is a different, small store and doesn't fit the supermarket layout.

## Mapping

| Store component | Asset |
|---|---|
| Architecture (floor, walls, ceiling, trusses) | supermarket.glb |
| Aisles / gondola shelving | supermarket.glb (6 runs, 12 faces) |
| Product displays | catalog products from Supabase, placed on measured faces (labelled placeholder shapes until per-product GLBs are uploaded) |
| Price tags, aisle signs | runtime (live prices in EUR/USD) |
| Customer trolley | trolley.glb |
| Checkout area | supermarket.glb counter + interaction zone |
| Entrance trolleys / baskets, freezers, wall racks | supermarket.glb (decor; not stocked yet) |

## Browser verification (2026-11-20)

- supermarket.glb: renders, colliders/shelves line up, normal maps softened at runtime (`normalScale 0.3`).
- trolley.glb: correct scale/orientation (handle toward player, green grips), basket holds cart units.
- Benchmark aisle: products on all 4 boards of both faces, price tags readable, sign fits.

## Benchmark & rollout

- **Benchmark aisle:** between runs L1 and L2 (faces `L1N`, `L2S`), straight ahead from the spawn point.
- **Rollout:** set `STORE_CONFIG.stockAllFaces = true` in `env/supermarket.ts` after the benchmark is approved in the browser. End caps, wall racks and freezers need face definitions added in `build_env.py`.

## License / attribution — ACTION NEEDED

The Sketchfab license and author for each file must be recorded here before production. Most free Sketchfab models are CC-BY and require visible attribution. Confirm on each model's Sketchfab page:

| File | Author | License | Attribution required |
|---|---|---|---|
| super_market_for_free.glb | ? | ? | ? |
| cart_basket.glb | ? | ? | ? |
| LPG_Lite.glb | ? | ? | ? |
| mini_market.glb | ? | ? | ? |

## Rebuild

```
python tools/assets/build_env.py "3D models/super_market_for_free.glb" public/models/env/supermarket.glb src/features/store3d/env/supermarket.layout.json
python tools/assets/build_trolley.py "3D models/cart_basket.glb" public/models/props/trolley.glb
```

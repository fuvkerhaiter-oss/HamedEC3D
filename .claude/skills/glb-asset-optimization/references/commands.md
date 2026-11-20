# GLB Commands & Integration Snippets

Tools: `@gltf-transform/cli` (run via `npx`, no install needed), `gltfjsx` (`npx gltfjsx`).

## Inspect
```
npx @gltf-transform/cli inspect model.glb
```

## Optimize (writes a new file; never overwrite the original)
```
npx @gltf-transform/cli optimize model.glb model.opt.glb --compress meshopt --texture-compress webp --texture-size 1024
# or step by step:
npx @gltf-transform/cli dedup in.glb out.glb
npx @gltf-transform/cli weld out.glb out.glb
npx @gltf-transform/cli draco out.glb out.glb
npx @gltf-transform/cli resize out.glb out.glb --width 1024 --height 1024
```
- Simplify only with approval and a visual check: `simplify --ratio 0.5 --error 0.001`.
- Draco/Meshopt require the matching decoder: drei `useGLTF(url, true)` (Draco) or meshopt decoder.

## Generate a typed component
```
npx gltfjsx model.opt.glb --types --shadows --instance
```

## Instancing repeated products
```jsx
const { nodes, materials } = useGLTF('/models/can.opt.glb')
<Instances geometry={nodes.Can.geometry} material={materials.Can} limit={500}>
  {positions.map((p, i) => <Instance key={i} position={p} />)}
</Instances>
```

## LOD
```jsx
<Detailed distances={[0, 15, 40]}>
  <HighModel /> <MidModel /> <LowBox />
</Detailed>
```

## Lazy loading
- Wrap aisles in `<Suspense fallback={null}>`; `useGLTF.preload(url)` only for first-view assets.
- Load distant aisles on proximity/visibility.

## Material reuse
- Map identical materials to one instance; avoid cloning materials per product unless color differs (then prefer instance color).

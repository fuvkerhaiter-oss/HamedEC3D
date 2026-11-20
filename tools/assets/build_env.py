"""
super_market_for_free.glb (Sketchfab) → public/models/env/supermarket.glb + src/features/store3d/env/supermarket.layout.json

What it does (original file is never modified):
1. Drops the showcase grid floating ~20 m above the building (backdrop + sample items).
2. Drops the generic pre-stocked products baked onto shelves/fridges (materials listed in PRODUCT_MATERIALS);
   real catalog products are placed at runtime from the database instead.
3. Bakes node transforms and merges all remaining geometry per material (~3,600 meshes → ~25 draw calls).
4. Downscales textures to ≤1024 px.
5. Measures the fixtures and writes a layout JSON: room bounds, wall + fixture colliders, gondola runs,
   shelf faces with board heights, checkout counter, spawn point.
Usage: python tools/assets/build_env.py "<src>/super_market_for_free.glb" public/models/env/supermarket.glb src/features/store3d/env/supermarket.layout.json
"""
import json, sys
import numpy as np
from glbio import load, node_matrix, read_accessor, image_bytes, resize_image, GlbBuilder

SRC, DST, LAYOUT = sys.argv[1], sys.argv[2], sys.argv[3]
PRODUCT_MATERIALS = {10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20}  # sample-product texture atlases (verified by render)
FLOATING_Y = 15.0
MAX_TEX = 1024

js, binc = load(SRC)
nodes = js["nodes"]

# ── 1. Collect kept primitives in world space ──
by_mat = {}
groups = []  # (name, lo, hi) for layout measurement
dropped = {"floating": 0, "products": 0}
def walk(i, parent):
    n = nodes[i]; W = parent @ node_matrix(n)
    if "mesh" in n:
        for p in js["meshes"][n["mesh"]]["primitives"]:
            mi = p.get("material")
            pos = read_accessor(js, binc, p["attributes"]["POSITION"]).astype(np.float64)
            wp = (np.c_[pos, np.ones(len(pos))] @ W.T)[:, :3]
            if wp[:, 1].min() > FLOATING_Y:
                dropped["floating"] += 1; continue
            if mi in PRODUCT_MATERIALS:
                dropped["products"] += 1; continue
            N3 = np.linalg.inv(W[:3, :3]).T
            nrm = read_accessor(js, binc, p["attributes"]["NORMAL"]).astype(np.float64) @ N3.T
            nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
            uv = read_accessor(js, binc, p["attributes"]["TEXCOORD_0"]).astype(np.float32) if "TEXCOORD_0" in p["attributes"] else np.zeros((len(pos), 2), np.float32)
            idx = read_accessor(js, binc, p["indices"]).astype(np.uint32).ravel() if "indices" in p else np.arange(len(pos), dtype=np.uint32)
            if np.linalg.det(W[:3, :3]) < 0:
                idx = idx.reshape(-1, 3)[:, ::-1].ravel()
            by_mat.setdefault(mi, []).append((wp.astype(np.float32), nrm.astype(np.float32), uv, idx))
            groups.append((n.get("name", f"node{i}"), mi, wp.min(0), wp.max(0)))
    for c in n.get("children", []):
        walk(c, W)
for r in js["scenes"][js.get("scene", 0)]["nodes"]:
    walk(r, np.eye(4))

# ── 2. Merge per material & write GLB ──
g = GlbBuilder()
tex_map, images, textures = {}, [], []
def remap_texture(ref):
    if ref is None: return None
    old = ref["index"]
    if old not in tex_map:
        src = js["textures"][old]["source"]
        data, mime = image_bytes(js, binc, src)
        data, mime = resize_image(data, mime, MAX_TEX)
        images.append(g.add_image(data, mime))
        textures.append({"sampler": 0, "source": len(images) - 1})
        tex_map[old] = len(textures) - 1
    out = dict(ref); out["index"] = tex_map[old]; return out

materials, meshes, scene_nodes = [], [], []
total_tris = 0
for mi, parts in sorted(by_mat.items(), key=lambda kv: (kv[0] is None, kv[0])):
    src = json.loads(json.dumps(js["materials"][mi])) if mi is not None else {"name": "default"}
    pbr = src.get("pbrMetallicRoughness", {})
    for key in ("baseColorTexture", "metallicRoughnessTexture"):
        if key in pbr: pbr[key] = remap_texture(pbr[key])
    for key in ("normalTexture", "occlusionTexture", "emissiveTexture"):
        if key in src: src[key] = remap_texture(src[key])
    for k in [k for k, v in src.items() if v is None]: del src[k]
    materials.append(src)
    P = np.concatenate([p[0] for p in parts]); Nn = np.concatenate([p[1] for p in parts]); UV = np.concatenate([p[2] for p in parts])
    offs = np.cumsum([0] + [len(p[0]) for p in parts[:-1]])
    I = np.concatenate([p[3] + o for p, o in zip(parts, offs)]).astype(np.uint32)
    total_tris += len(I) // 3
    attrs = {"POSITION": g.add_accessor(P, "VEC3", 34962, minmax=True), "NORMAL": g.add_accessor(Nn, "VEC3", 34962),
             "TEXCOORD_0": g.add_accessor(UV, "VEC2", 34962)}
    meshes.append({"name": src.get("name", f"mat{mi}"), "primitives": [{"attributes": attrs, "indices": g.add_accessor(I, "SCALAR", 34963), "material": len(materials) - 1}]})
    scene_nodes.append({"name": f"Env_{src.get('name', mi)}", "mesh": len(meshes) - 1})

gltf = {
    "asset": {"version": "2.0", "generator": "vsw tools/assets/build_env.py",
              "copyright": "Source: Sketchfab 'super market for free' — see ASSET_INVENTORY.md for license/attribution"},
    "scene": 0, "scenes": [{"nodes": list(range(len(scene_nodes)))}], "nodes": scene_nodes, "meshes": meshes,
    "materials": materials, "textures": textures, "images": images,
    "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
}
g.write(DST, gltf)
print(f"wrote {DST}: {len(g.bin) / 1e6:.1f} MB, {len(meshes)} meshes, {total_tris:,} tris, dropped {dropped}")

# ── 3. Measure layout ──
def box(lo, hi): return {"min": [round(float(v), 3) for v in lo], "max": [round(float(v), 3) for v in hi]}
walls, fixtures = [], []
for name, mi, lo, hi in groups:
    if lo[1] > 2.4 or hi[1] - lo[1] < 0.2: continue
    (walls if max(hi[0] - lo[0], hi[2] - lo[2]) > 9 else fixtures).append([lo.copy(), hi.copy(), name])
def overlap(a, b, e=0.03): return np.all(a[0] - e <= b[1]) and np.all(b[0] - e <= a[1])
merged = True
while merged:
    merged = False
    for i in range(len(fixtures)):
        for j in range(i + 1, len(fixtures)):
            if overlap(fixtures[i], fixtures[j]):
                fixtures[i] = [np.minimum(fixtures[i][0], fixtures[j][0]), np.maximum(fixtures[i][1], fixtures[j][1]), fixtures[i][2]]
                fixtures.pop(j); merged = True; break
        if merged: break

# Interior from the four perimeter walls (inner faces).
wx = [w for w in walls if (w[1][2] - w[0][2]) > 9]   # walls running along z (left/right)
wz = [w for w in walls if (w[1][0] - w[0][0]) > 9 and (w[1][1] - w[0][1]) > 3]  # tall walls along x
left = max(w for w in wx if w[0][0] < 0)[1][0] if False else max(w[1][0] for w in wx if w[0][0] < 0)
right = min(w[0][0] for w in wx if w[0][0] > 0)
front = min(w[0][2] for w in wz if w[0][2] > 0)
# Back: the back "wall" mesh is a facade slab; the true interior reaches the back wall racks.
back_racks = [f for f in fixtures if f[1][2] < -5.5 and f[0][2] > -7.0]
back = min(f[0][2] for f in back_racks) if back_racks else max(w[1][2] for w in wz if w[0][2] < 0)
interior = {"min": [round(left, 3), 0, round(back, 3)], "max": [round(right, 3), 5.87, round(front, 3)]}
T = 0.3
wall_boxes = [box([left - T, 0, back - T], [left, 4, front + T]), box([right, 0, back - T], [right + T, 4, front + T]),
              box([left - T, 0, back - T], [right + T, 4, back]), box([left - T, 0, front], [right + T, 4, front + T])]

runs = []
for lo, hi, name in fixtures:
    size = hi - lo
    if 6.0 < size[0] < 8.0 and 1.0 < size[2] < 1.5 and size[1] > 2.0:
        runs.append((lo, hi))
# Gondola body (without end caps) measured from the black frame groups.
frames = [(lo, hi) for name, mi, lo, hi in groups if 6.0 < hi[0] - lo[0] < 7.0 and 1.0 < hi[2] - lo[2] < 1.2 and hi[1] - lo[1] > 2.0]
BOARDS = [0.46, 0.94, 1.41, 1.89]  # top surfaces measured from horizontal faces (identical on all six runs)
faces, run_list = [], []
for k, (lo, hi) in enumerate(sorted(frames, key=lambda b: (round(b[0][0]), b[0][2]))):
    cz = (lo[2] + hi[2]) / 2
    col = "L" if lo[0] < 2 else "R"
    rid = f"{col}{k % 3 + 1}"
    run_list.append({"id": rid, "box": box(lo, hi)})
    bay = (hi[0] - lo[0]) / 3
    bays = [[round(lo[0] + b * bay + 0.06, 3), round(lo[0] + (b + 1) * bay - 0.06, 3)] for b in range(3)]
    for side, edge in ((-1, lo[2]), (1, hi[2])):
        faces.append({"id": f"{rid}{'S' if side < 0 else 'N'}", "run": rid, "normal": [0, 0, side],
                      "frontEdge": round(float(edge), 3), "backEdge": round(float(cz - side * 0.03), 3),
                      "bays": bays, "boards": BOARDS, "clearance": 0.42})

checkout = [f for f in fixtures if -12 < f[0][0] < -10 and 1.0 < f[1][1] < 2 and f[0][2] > 3]
layout = {
    "source": "super_market_for_free.glb", "generatedBy": "tools/assets/build_env.py",
    "interior": interior, "ceilingY": 5.87,
    "walls": wall_boxes,
    "fixtures": [box(lo, hi) for lo, hi, _ in fixtures if not (hi[1] > 4 and lo[2] < back - 0.01)],
    "runs": run_list, "faces": faces,
    "checkout": box(*checkout[0][:2]) if checkout else None,
}
json.dump(layout, open(LAYOUT, "w"), indent=1)
print(f"layout: interior {interior}, {len(faces)} faces, {len(layout['fixtures'])} fixture colliders, checkout {layout['checkout']}")

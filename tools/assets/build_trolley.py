"""
cart_basket.glb (Sketchfab, spec-gloss, cm units) → public/models/props/trolley.glb
- Converts KHR_materials_pbrSpecularGlossiness → metallic-roughness (three.js no longer supports spec-gloss).
- Textures downscaled 2048 → 1024. Geometry, UVs, normals and tangents untouched.
- Scale/orientation are NOT baked; the asset registry applies scale 0.01 and a 180° yaw.
Usage: python tools/assets/build_trolley.py "<src>/cart_basket.glb" public/models/props/trolley.glb
"""
import io, sys
import numpy as np
from PIL import Image
from glbio import load, image_bytes, GlbBuilder, read_accessor

SRC, DST = sys.argv[1], sys.argv[2]
TEX = 1024
js, binc = load(SRC)
mat = js["materials"][0]
sg = mat["extensions"]["KHR_materials_pbrSpecularGlossiness"]
img_of = lambda tex_index: js["textures"][tex_index]["source"]

def pil(i):
    return Image.open(io.BytesIO(image_bytes(js, binc, i)[0]))

srgb_to_lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
lin_to_srgb = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, None), 1 / 2.4) - 0.055)

diffuse = srgb_to_lin(np.asarray(pil(img_of(sg["diffuseTexture"]["index"])).convert("RGB").resize((TEX, TEX), Image.LANCZOS)) / 255.0)
sgimg = pil(img_of(sg["specularGlossinessTexture"]["index"])).convert("LA").resize((TEX, TEX), Image.LANCZOS)
sga = np.asarray(sgimg) / 255.0
spec = srgb_to_lin(np.repeat(sga[..., :1], 3, axis=2))
gloss = sga[..., 1]

# Babylon.js / Khronos reference conversion (per pixel).
DIEL = 0.04
bright = lambda c: np.sqrt(0.299 * c[..., 0] ** 2 + 0.587 * c[..., 1] ** 2 + 0.114 * c[..., 2] ** 2)
one_minus_spec = 1 - spec.max(axis=2)
db, sb = bright(diffuse), bright(spec)
a, b, c = DIEL, db * one_minus_spec / (1 - DIEL) + sb - 2 * DIEL, DIEL - sb
disc = np.clip(b * b - 4 * a * c, 0, None)
metallic = np.where(sb < DIEL, 0.0, np.clip((-b + np.sqrt(disc)) / (2 * a), 0, 1))
eps = 1e-6
from_diff = diffuse * (one_minus_spec / (1 - DIEL) / np.maximum(1 - metallic, eps))[..., None]
from_spec = (spec - DIEL * (1 - metallic)[..., None]) / np.maximum(metallic, eps)[..., None]
m2 = (metallic ** 2)[..., None]
base = np.clip(from_diff * (1 - m2) + from_spec * m2, 0, 1)
rough = np.clip(1 - gloss * sg.get("glossinessFactor", 1.0), 0.04, 1)

def enc(arr, fmt="JPEG"):
    out = io.BytesIO(); Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out, fmt, quality=88, optimize=True)
    return out.getvalue()

base_jpg = enc(lin_to_srgb(base))
mr = np.stack([np.ones_like(rough), rough, metallic], axis=2)
mr_png = enc(mr, "PNG")
normal = pil(img_of(mat["normalTexture"]["index"])).convert("RGB").resize((TEX, TEX), Image.LANCZOS)
occ = pil(img_of(mat["occlusionTexture"]["index"])).convert("RGB").resize((TEX, TEX), Image.LANCZOS)
nbuf, obuf = io.BytesIO(), io.BytesIO(); normal.save(nbuf, "PNG", optimize=True); occ.convert("L").convert("RGB").save(obuf, "JPEG", quality=90)

g = GlbBuilder()
images = [g.add_image(base_jpg, "image/jpeg"), g.add_image(mr_png, "image/png"),
          g.add_image(nbuf.getvalue(), "image/png"), g.add_image(obuf.getvalue(), "image/jpeg")]
meshes = []
for m in js["meshes"]:
    prims = []
    for p in m["primitives"]:
        attrs = {}
        for key, kind in (("POSITION", "VEC3"), ("NORMAL", "VEC3"), ("TANGENT", "VEC4"), ("TEXCOORD_0", "VEC2")):
            if key in p["attributes"]:
                arr = read_accessor(js, binc, p["attributes"][key]).astype(np.float32)
                attrs[key] = g.add_accessor(arr, kind, 34962, minmax=key == "POSITION")
        idx = read_accessor(js, binc, p["indices"]).astype(np.uint32).ravel()
        prims.append({"attributes": attrs, "indices": g.add_accessor(idx, "SCALAR", 34963), "material": 0})
    meshes.append({"name": m.get("name", "Trolley"), "primitives": prims})

material = {
    "name": "Trolley_Chrome",
    "doubleSided": True,
    "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicRoughnessTexture": {"index": 1},
                             "metallicFactor": 1.0, "roughnessFactor": 1.0},
    "normalTexture": {"index": 2},
    "occlusionTexture": {"index": 3},
}
gltf = {
    "asset": {"version": "2.0", "generator": "vsw tools/assets/build_trolley.py",
              "copyright": "Source: Sketchfab 'cart_basket' — see ASSET_INVENTORY.md for license/attribution"},
    "scene": 0, "scenes": [{"nodes": [0]}],
    "nodes": [{"name": "Trolley", "matrix": js["nodes"][0]["matrix"], "children": [1, 2]},
              {"name": "Basket_A", "mesh": 0}, {"name": "Basket_B", "mesh": 1}],
    "meshes": meshes, "materials": [material],
    "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
    "textures": [{"sampler": 0, "source": i} for i in range(4)],
    "images": images,
}
g.write(DST, gltf)
print(f"wrote {DST}: {len(g.bin) / 1e6:.1f} MB, metallic mean {metallic.mean():.2f}, roughness mean {rough.mean():.2f}")

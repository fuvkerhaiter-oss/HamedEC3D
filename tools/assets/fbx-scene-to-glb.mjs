/**
 * Multi-part FBX scene → plain GLB with one node per named part, ready for tools/assets/optimize-glb.mjs.
 *   node tools/assets/fbx-scene-to-glb.mjs <in.fbx> <out.glb> --node=<name>:<fbxMesh>[,<fbxMesh>...] [--node=...]
 *        [--tex-dir=<dir>] [--tex=2048] [--unit=0.01] [--mat=<fbxMaterial>:<hex>[:<roughness>[:<metalness>[:emissive]]]]
 *
 * - Parses with three.js' FBXLoader (headless). Every listed FBX mesh is baked with its world transform, converted to
 *   meters (--unit = metres per FBX unit; 0.01 for centimetres) and welded. Meshes of one --node are merged into one
 *   glTF mesh (one primitive per material), translated so the part stands on y = 0, centred in x/z.
 * - UVs are flipped to glTF convention (v = 1 − v).
 * - Materials: Phong colour → baseColorFactor (or --mat override); a material whose texture (map.name) matches a
 *   file in --tex-dir (by base name, any extension) gets it as baseColorTexture, resized to --tex px (JPEG).
 * The source FBX and textures are never modified.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

globalThis.self ??= globalThis;
globalThis.window ??= globalThis;
globalThis.document ??= { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {} }) };
const THREE = await import("three");
const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
const { mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");

const [input, output, ...flags] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: fbx-scene-to-glb.mjs <in.fbx> <out.glb> --node=name:meshA,meshB [--tex-dir=] [--tex=2048] [--unit=0.01] [--mat=name:hex:rough:metal:emissive]");
const nodeSpecs = [];
const matOverride = new Map();
const opt = {};
for (const f of flags) {
  const [k, v = ""] = f.replace(/^--/, "").split(/=(.*)/s);
  if (k === "node") {
    const [name, list] = v.split(":");
    nodeSpecs.push({ name, meshes: list.split(",") });
  } else if (k === "mat") {
    const [name, hex, rough, metal, emissive] = v.split(":");
    matOverride.set(name, { hex, rough: rough ? Number(rough) : undefined, metal: metal ? Number(metal) : undefined, emissive: emissive === "emissive" });
  } else opt[k] = v;
}
if (!nodeSpecs.length) throw new Error("at least one --node=name:mesh is required");
const TEX = Number(opt.tex ?? 2048);
const UNIT = Number(opt.unit ?? 0.01);
const texDir = opt["tex-dir"];

const buf = fs.readFileSync(input);
const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
root.updateMatrixWorld(true);
const byName = new Map();
root.traverse((o) => o.isMesh && byName.set(o.name, o));

// ---- GLB writer state ----
const chunks = [];
let len = 0;
const bufferViews = [];
const accessors = [];
function push(bytes, target) {
  const pad = (4 - (len % 4)) % 4;
  if (pad) { chunks.push(new Uint8Array(pad)); len += pad; }
  chunks.push(bytes);
  bufferViews.push({ buffer: 0, byteOffset: len, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
  len += bytes.byteLength;
  return bufferViews.length - 1;
}
function accessor(arr, type, componentType, target, minmax) {
  const view = push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), target);
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
  const a = { bufferView: view, componentType, count: arr.length / n, type };
  if (minmax) {
    a.min = Array(n).fill(Infinity); a.max = Array(n).fill(-Infinity);
    for (let i = 0; i < arr.length; i++) { a.min[i % n] = Math.min(a.min[i % n], arr[i]); a.max[i % n] = Math.max(a.max[i % n], arr[i]); }
  }
  accessors.push(a);
  return accessors.length - 1;
}

const images = [];
const textures = [];
const materials = [];
const materialIndex = new Map();
const lin = (hex) => { const c = new THREE.Color(`#${hex}`); return [c.r, c.g, c.b]; }; // THREE.Color stores linear

async function textureFor(mapName) {
  if (!texDir || !mapName) return null;
  const want = path.parse(mapName).name.toLowerCase();
  const file = fs.readdirSync(texDir).find((f) => path.parse(f).name.toLowerCase() === want && /\.(jpe?g|png|webp)$/i.test(f));
  if (!file) { console.warn(`texture ${mapName}: not found in ${texDir}`); return null; }
  const meta = await sharp(path.join(texDir, file)).metadata();
  const size = Math.min(TEX, meta.width, meta.height);
  const jpg = await sharp(path.join(texDir, file)).resize(size, size, { fit: "fill" }).removeAlpha().jpeg({ quality: 90 }).toBuffer();
  images.push({ bufferView: push(new Uint8Array(jpg)), mimeType: "image/jpeg" });
  textures.push({ source: images.length - 1 });
  console.log(`texture ${file} → ${size}px`);
  return { index: textures.length - 1 };
}

async function material(m) {
  if (materialIndex.has(m.name)) return materialIndex.get(m.name);
  const o = matOverride.get(m.name);
  const tex = await textureFor(m.map?.name);
  const pbr = {
    baseColorFactor: [...(tex ? [1, 1, 1] : o?.hex ? lin(o.hex) : [m.color.r, m.color.g, m.color.b]), 1],
    metallicFactor: o?.metal ?? 0,
    roughnessFactor: o?.rough ?? Math.max(0.2, Math.min(0.9, 1 - Math.sqrt((m.shininess ?? 30) / 1000))),
  };
  if (tex) pbr.baseColorTexture = tex;
  const mat = { name: m.name, pbrMetallicRoughness: pbr };
  if (o?.emissive) mat.emissiveFactor = lin(o.hex);
  materials.push(mat);
  materialIndex.set(m.name, materials.length - 1);
  return materials.length - 1;
}

const meshes = [];
const nodes = [];
for (const spec of nodeSpecs) {
  // Bake every listed mesh into metres, split by material.
  const parts = new Map(); // material name → geometries
  const bbox = new THREE.Box3();
  for (const meshName of spec.meshes) {
    const mesh = byName.get(meshName);
    if (!mesh) throw new Error(`mesh "${meshName}" not in FBX (has: ${[...byName.keys()].join(", ")})`);
    const mats = [].concat(mesh.material);
    const geo = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().makeScale(UNIT, UNIT, UNIT).multiply(mesh.matrixWorld));
    for (const k of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(k)) geo.deleteAttribute(k);
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.index ? geo.index.count : geo.attributes.position.count, materialIndex: 0 }];
    for (const g of groups) {
      const m = mats[g.materialIndex ?? 0];
      const sub = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(geo.attributes)) {
        const arr = new Float32Array(g.count * a.itemSize);
        for (let i = 0; i < g.count; i++) {
          const src = geo.index ? geo.index.getX(g.start + i) : g.start + i;
          for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.array[src * a.itemSize + c];
        }
        sub.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize));
      }
      if (!parts.has(m)) parts.set(m, []);
      parts.get(m).push(sub);
      sub.computeBoundingBox();
      bbox.union(sub.boundingBox);
    }
  }
  const base = new THREE.Vector3((bbox.min.x + bbox.max.x) / 2, bbox.min.y, (bbox.min.z + bbox.max.z) / 2);
  const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
  const primitives = [];
  let tris = 0;
  for (const [m, geos] of parts) {
    let geo = geos.length > 1 ? mergeGeometries(geos) : geos[0];
    geo.translate(-base.x, -base.y, -base.z);
    if (!geo.attributes.uv) geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    // FBX UVs start bottom-left, glTF UVs top-left.
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    geo = mergeVertices(geo, 1e-6);
    const vcount = geo.attributes.position.count;
    tris += geo.index.count / 3;
    primitives.push({
      attributes: {
        POSITION: accessor(Float32Array.from(geo.attributes.position.array), "VEC3", 5126, 34962, true),
        NORMAL: accessor(Float32Array.from(geo.attributes.normal.array), "VEC3", 5126, 34962),
        TEXCOORD_0: accessor(Float32Array.from(geo.attributes.uv.array), "VEC2", 5126, 34962),
      },
      indices: accessor(vcount > 65535 ? Uint32Array.from(geo.index.array) : Uint16Array.from(geo.index.array), "SCALAR", vcount > 65535 ? 5125 : 5123, 34963),
      material: await material(m),
    });
  }
  const size = bbox.getSize(new THREE.Vector3());
  console.log(`node ${spec.name}: ${tris} tris, ${primitives.length} primitives, size ${size.toArray().map((v) => v.toFixed(3)).join(" × ")} m`);
  meshes.push({ name: spec.name, primitives });
  nodes.push({ name: spec.name, mesh: meshes.length - 1 });
}

const gltf = {
  asset: { version: "2.0", generator: "tools/assets/fbx-scene-to-glb.mjs" },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, i) => i) }],
  nodes,
  meshes,
  materials,
  ...(textures.length ? { textures, images } : {}),
  accessors,
  bufferViews,
  buffers: [{ byteLength: len }],
};
const bin = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
let json = Buffer.from(JSON.stringify(gltf));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binPad.length, 8);
const ch = (n, t) => { const b = Buffer.alloc(8); b.writeUInt32LE(n, 0); b.write(t, 4, "latin1"); return b; };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, Buffer.concat([header, ch(json.length, "JSON"), json, ch(binPad.length, "BIN\0"), binPad]));
console.log(`wrote ${output} (${(fs.statSync(output).size / 1e6).toFixed(2)} MB)`);

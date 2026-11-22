/**
 * FBX (+ separate PBR texture PNGs, e.g. a Meshy export) → plain GLB, ready for tools/assets/optimize-glb.mjs.
 *   node tools/assets/fbx-to-glb.mjs <in.fbx> <out.glb> --base=<color.png> [--normal=<n.png>] [--metallic=<m.png>]
 *        [--roughness=<r.png>] [--tex=1024] [--axis=z] [--length=1]
 *
 * - Parses with three.js' FBXLoader (headless: only geometry is used; textures come from the given PNGs).
 * - Bakes the mesh into meters and turns its long axis (--axis, local) onto +X, centred on the origin and scaled so
 *   that the long axis is --length meters (the chain segment is tiled along X at runtime).
 * - Welds duplicate vertices (indexed geometry), so the optimizer can simplify it.
 * - Textures resized to --tex px; metallic (B) + roughness (G) packed into one glTF metallicRoughness PNG.
 * The source FBX and PNGs are never modified.
 */
import fs from "node:fs";
import sharp from "sharp";

// FBXLoader touches `document`/`self` when it meets texture references; we never load those.
globalThis.self ??= globalThis;
globalThis.window ??= globalThis;
globalThis.document ??= { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {} }) };
const THREE = await import("three");
const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
const { mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");

const [input, output, ...flags] = process.argv.slice(2);
const opt = Object.fromEntries(flags.map((f) => f.replace(/^--/, "").split("=")));
if (!input || !output || !opt.base) throw new Error("usage: fbx-to-glb.mjs <in.fbx> <out.glb> --base=<color.png> [--normal=] [--metallic=] [--roughness=] [--tex=1024] [--axis=z] [--length=1]");
const TEX = Number(opt.tex ?? 1024);
const LENGTH = Number(opt.length ?? 1);
const axis = { x: 0, y: 1, z: 2 }[opt.axis ?? "z"];

const buf = fs.readFileSync(input);
const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
const meshes = [];
root.traverse((o) => o.isMesh && meshes.push(o));
if (meshes.length !== 1) throw new Error(`expected 1 mesh, found ${meshes.length}`);
let geo = meshes[0].geometry.clone();
for (const k of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(k)) geo.deleteAttribute(k);

// Long local axis → +X (a proper rotation, so winding and normals stay valid).
const rot = new THREE.Matrix4();
if (axis === 2) rot.makeRotationY(Math.PI / 2); // (x,y,z) → (z, y, -x)
else if (axis === 1) rot.makeRotationZ(-Math.PI / 2); // (x,y,z) → (y, -x, z)
geo.applyMatrix4(rot);
geo.computeBoundingBox();
const bb = geo.boundingBox;
const c = bb.getCenter(new THREE.Vector3());
const k = LENGTH / (bb.max.x - bb.min.x);
geo.translate(-c.x, -c.y, -c.z).scale(k, k, k);
geo = mergeVertices(geo, 1e-5);
geo.computeBoundingBox();
console.log(`mesh: ${geo.attributes.position.count} verts, ${geo.index.count / 3} tris, box`, geo.boundingBox.min.toArray().map((v) => v.toFixed(3)), geo.boundingBox.max.toArray().map((v) => v.toFixed(3)));

// ---- GLB writer ----
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
const f32 = (attr) => Float32Array.from(attr.array);
const vcount = geo.attributes.position.count;
const attributes = {
  POSITION: accessor(f32(geo.attributes.position), "VEC3", 5126, 34962, true),
  NORMAL: accessor(f32(geo.attributes.normal), "VEC3", 5126, 34962),
  TEXCOORD_0: accessor(f32(geo.attributes.uv), "VEC2", 5126, 34962),
};
const indices = accessor(vcount > 65535 ? Uint32Array.from(geo.index.array) : Uint16Array.from(geo.index.array), "SCALAR", vcount > 65535 ? 5125 : 5123, 34963);

const images = [];
const textures = [];
async function image(png) {
  const bytes = new Uint8Array(png);
  images.push({ bufferView: push(bytes), mimeType: "image/png" });
  textures.push({ source: images.length - 1 });
  return { index: textures.length - 1 };
}
const resize = (file) => sharp(file).resize(TEX, TEX, { fit: "fill" });
const material = { name: "chain", pbrMetallicRoughness: { baseColorTexture: await image(await resize(opt.base).removeAlpha().png().toBuffer()) } };
if (opt.normal) material.normalTexture = await image(await resize(opt.normal).removeAlpha().png().toBuffer());
if (opt.metallic || opt.roughness) {
  const gray = async (f, fallback) => (f ? resize(f).greyscale().raw().toBuffer() : Buffer.alloc(TEX * TEX, fallback));
  const [m, r] = await Promise.all([gray(opt.metallic, 255), gray(opt.roughness, 128)]);
  const rgb = Buffer.alloc(TEX * TEX * 3);
  for (let i = 0; i < TEX * TEX; i++) { rgb[i * 3] = 255; rgb[i * 3 + 1] = r[i]; rgb[i * 3 + 2] = m[i]; }
  material.pbrMetallicRoughness.metallicRoughnessTexture = await image(await sharp(rgb, { raw: { width: TEX, height: TEX, channels: 3 } }).png().toBuffer());
  material.pbrMetallicRoughness.metallicFactor = 1;
  material.pbrMetallicRoughness.roughnessFactor = 1;
}

const gltf = {
  asset: { version: "2.0", generator: "tools/assets/fbx-to-glb.mjs" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "chain", mesh: 0 }],
  meshes: [{ name: "chain", primitives: [{ attributes, indices, material: 0 }] }],
  materials: [material],
  textures,
  images,
  samplers: [],
  accessors,
  bufferViews,
  buffers: [{ byteLength: len }],
};
delete gltf.samplers;
const bin = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
let json = Buffer.from(JSON.stringify(gltf));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binPad.length, 8);
const ch = (n, t) => { const b = Buffer.alloc(8); b.writeUInt32LE(n, 0); b.write(t, 4, "latin1"); return b; };
fs.writeFileSync(output, Buffer.concat([header, ch(json.length, "JSON"), json, ch(binPad.length, "BIN\0"), binPad]));
console.log(`wrote ${output} (${(fs.statSync(output).size / 1e6).toFixed(2)} MB)`);

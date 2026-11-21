/**
 * Web optimization for the store's GLB copies (non-destructive: writes a NEW file next to the input).
 *   node tools/assets/optimize-glb.mjs <in.glb> <out.glb> [--simplify=<ratio>] [--error=<relative error>] [--webp=<quality>]
 *
 * - Optional mesh simplification (meshoptimizer; error is relative to the mesh size, UV/normal seams kept).
 * - Vertex-cache/fetch reordering, then EXT_meshopt_compression of every vertex/index buffer.
 *   Positions/UVs keep float32 through the exponential filter; normals/tangents become 8-bit octahedral
 *   (KHR_mesh_quantization). Both are decoded natively by three.js (drei's useGLTF registers the decoder).
 * - Textures re-encoded as WebP (EXT_texture_webp), same resolution.
 * Scene graph, materials and node transforms are untouched.
 */
import fs from "node:fs";
import sharp from "sharp";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const [input, output, ...flags] = process.argv.slice(2);
if (!input || !output || input === output) throw new Error("usage: optimize-glb.mjs <in.glb> <out.glb> [--simplify=0.25] [--error=0.002] [--webp=88]");
const opt = Object.fromEntries(flags.map((f) => f.replace(/^--/, "").split("=")));
const ratio = opt.simplify ? Number(opt.simplify) : 1;
const maxError = opt.error ? Number(opt.error) : 0.001;
const webpQuality = opt.webp ? Number(opt.webp) : 88;

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

// ---- read GLB ----
const glb = fs.readFileSync(input);
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString("utf8"));
const binStart = 20 + jsonLen + 8;
const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen));

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ARRAY = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

function readAccessor(i) {
  const a = gltf.accessors[i];
  const bv = gltf.bufferViews[a.bufferView];
  const Arr = ARRAY[a.componentType];
  const n = COMPONENTS[a.type];
  if (a.sparse || (bv.byteStride && bv.byteStride !== n * Arr.BYTES_PER_ELEMENT)) throw new Error(`accessor ${i}: interleaved/sparse not supported`);
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const copy = new Uint8Array(bin.subarray(off, off + a.count * n * Arr.BYTES_PER_ELEMENT)); // aligned copy
  return { arr: new Arr(copy.buffer), n, count: a.count };
}

// ---- output buffer: everything real goes into buffer 0 (GLB BIN); buffer 1 is the uncompressed fallback (no data) ----
const chunks = [];
let binLength = 0;
function push(bytes) {
  const offset = binLength;
  chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  binLength += bytes.byteLength;
  const pad = (4 - (binLength % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); binLength += pad; }
  return offset;
}
const bufferViews = [];
const accessors = [];
let fallbackLength = 0;

function addCompressed(raw, count, stride, mode, filter, target) {
  const enc = MeshoptEncoder.encodeGltfBuffer(raw, count, stride, mode, 0);
  const byteOffset = push(enc);
  const fbOffset = fallbackLength;
  fallbackLength += raw.byteLength + ((4 - (raw.byteLength % 4)) % 4);
  const ext = { buffer: 0, byteOffset, byteLength: enc.byteLength, byteStride: stride, mode, count };
  if (filter) ext.filter = filter;
  const view = { buffer: 1, byteOffset: fbOffset, byteLength: raw.byteLength, extensions: { EXT_meshopt_compression: ext } };
  if (mode === "ATTRIBUTES") view.byteStride = stride;
  if (target) view.target = target;
  bufferViews.push(view);
  return bufferViews.length - 1;
}

const stats = { trisBefore: 0, trisAfter: 0 };
for (const mesh of gltf.meshes) {
  for (const prim of mesh.primitives) {
    if ((prim.mode ?? 4) !== 4 || prim.indices == null || prim.targets) throw new Error("only indexed triangle meshes without morph targets");
    const pos = readAccessor(prim.attributes.POSITION);
    let indices = Uint32Array.from(readAccessor(prim.indices).arr);
    stats.trisBefore += indices.length / 3;

    if (ratio < 1) {
      const target = Math.max(3, Math.floor((indices.length * ratio) / 3) * 3);
      const [simplified] = MeshoptSimplifier.simplify(indices, pos.arr, 3, target, maxError, []);
      if (simplified.length >= 3) indices = simplified;
    }
    // Vertex-cache order + compact (drops vertices no longer referenced) → remap every attribute.
    const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, false);
    stats.trisAfter += indices.length / 3;

    for (const [name, accIndex] of Object.entries(prim.attributes)) {
      const src = readAccessor(accIndex);
      const old = gltf.accessors[accIndex];
      if (!(src.arr instanceof Float32Array)) throw new Error(`${name}: only float attributes supported`);
      const f = new Float32Array(unique * src.n);
      for (let v = 0; v < remap.length; v++) {
        const to = remap[v];
        if (to === 0xffffffff) continue;
        for (let c = 0; c < src.n; c++) f[to * src.n + c] = src.arr[v * src.n + c];
      }
      const acc = { componentType: 5126, count: unique, type: old.type };
      let view;
      if (name === "NORMAL" || name === "TANGENT") {
        const four = new Float32Array(unique * 4);
        for (let v = 0; v < unique; v++) for (let c = 0; c < 4; c++) four[v * 4 + c] = c < src.n ? f[v * src.n + c] : 1;
        const raw = MeshoptEncoder.encodeFilterOct(four, unique, 4, 8);
        view = addCompressed(raw, unique, 4, "ATTRIBUTES", "OCTAHEDRAL", 34962);
        Object.assign(acc, { componentType: 5120, normalized: true });
      } else if (name === "POSITION" || name.startsWith("TEXCOORD")) {
        const raw = MeshoptEncoder.encodeFilterExp(f, unique, src.n * 4, name === "POSITION" ? 16 : 14, name === "POSITION" ? "SharedVector" : "Separate");
        view = addCompressed(raw, unique, src.n * 4, "ATTRIBUTES", "EXPONENTIAL", 34962);
      } else {
        view = addCompressed(new Uint8Array(f.buffer), unique, src.n * 4, "ATTRIBUTES", null, 34962);
      }
      acc.bufferView = view;
      if (name === "POSITION") {
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (let v = 0; v < unique; v++) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], f[v * 3 + c]); max[c] = Math.max(max[c], f[v * 3 + c]); }
        Object.assign(acc, { min, max });
      }
      accessors.push(acc);
      prim.attributes[name] = accessors.length - 1;
    }
    const small = unique <= 65535;
    const idx = small ? Uint16Array.from(indices) : indices;
    const view = addCompressed(new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength), indices.length, small ? 2 : 4, "TRIANGLES", null, 34963);
    accessors.push({ bufferView: view, componentType: small ? 5123 : 5125, count: indices.length, type: "SCALAR" });
    prim.indices = accessors.length - 1;
  }
}

// ---- textures → WebP ----
let imgBefore = 0;
let imgAfter = 0;
const images = [];
for (const im of gltf.images ?? []) {
  const bv = gltf.bufferViews[im.bufferView];
  const src = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  const webp = await sharp(src).webp({ quality: webpQuality, effort: 6, alphaQuality: 90 }).toBuffer();
  imgBefore += src.byteLength;
  imgAfter += webp.byteLength;
  bufferViews.push({ buffer: 0, byteOffset: push(new Uint8Array(webp)), byteLength: webp.byteLength });
  images.push({ ...im, bufferView: bufferViews.length - 1, mimeType: "image/webp" });
}
for (const t of gltf.textures ?? []) {
  t.extensions = { ...t.extensions, EXT_texture_webp: { source: t.source } };
  delete t.source; // no PNG/JPEG fallback: every browser three.js supports (WebGL 2) decodes WebP
}

const ext = new Set([...(gltf.extensionsUsed ?? []), "EXT_meshopt_compression", "KHR_mesh_quantization", ...(images.length ? ["EXT_texture_webp"] : [])]);
const required = new Set([...(gltf.extensionsRequired ?? []), "EXT_meshopt_compression", "KHR_mesh_quantization", ...(images.length ? ["EXT_texture_webp"] : [])]);
const out = {
  ...gltf,
  accessors,
  bufferViews,
  images: images.length ? images : undefined,
  buffers: [{ byteLength: binLength }, { byteLength: fallbackLength, extensions: { EXT_meshopt_compression: { fallback: true } } }],
  extensionsUsed: [...ext],
  extensionsRequired: [...required],
};
out.asset = { ...gltf.asset, generator: `${gltf.asset?.generator ?? ""} + tools/assets/optimize-glb.mjs`.trim() };

// ---- write GLB ----
let json = Buffer.from(JSON.stringify(out), "utf8");
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const binBuf = Buffer.concat(chunks);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + binBuf.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(output, Buffer.concat([header, jh, json, bh, binBuf]));

const mb = (n) => (n / 1e6).toFixed(2) + " MB";
console.log(JSON.stringify({
  input, output, fileBefore: mb(glb.length), fileAfter: mb(fs.statSync(output).size),
  trisBefore: Math.round(stats.trisBefore), trisAfter: Math.round(stats.trisAfter), texturesBefore: mb(imgBefore), texturesAfter: mb(imgAfter),
}));

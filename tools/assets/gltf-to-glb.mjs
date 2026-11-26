/**
 * glTF (.gltf + external .bin + image files, e.g. a Blender export) → one self-contained GLB, ready for
 * tools/assets/optimize-glb.mjs.
 *   node tools/assets/gltf-to-glb.mjs <in.gltf> <out.glb> [--tex=1024]
 *
 * - Every buffer and image is embedded; images larger than --tex px (longest side) are downsized, format kept.
 * - Scene graph, node transforms and materials are untouched. The source files are never modified.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const [input, output, ...flags] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: gltf-to-glb.mjs <in.gltf> <out.glb> [--tex=1024]");
const opt = Object.fromEntries(flags.map((f) => f.replace(/^--/, "").split("=")));
const TEX = Number(opt.tex ?? 1024);
const dir = path.dirname(input);
const gltf = JSON.parse(fs.readFileSync(input, "utf8"));
const read = (uri) => fs.readFileSync(path.join(dir, decodeURIComponent(uri)));

// Concatenate all buffers into one, shifting their buffer views.
const parts = [];
let len = 0;
const offsets = (gltf.buffers ?? []).map((b) => {
  const bytes = read(b.uri);
  const pad = (4 - (len % 4)) % 4;
  if (pad) { parts.push(Buffer.alloc(pad)); len += pad; }
  const at = len;
  parts.push(bytes);
  len += bytes.length;
  return at;
});
for (const v of gltf.bufferViews ?? []) {
  v.byteOffset = (v.byteOffset ?? 0) + offsets[v.buffer];
  v.buffer = 0;
}

for (const img of gltf.images ?? []) {
  if (!img.uri) continue;
  const src = read(img.uri);
  const png = img.mimeType === "image/png" || /\.png$/i.test(img.uri);
  const meta = await sharp(src).metadata();
  let bytes = src;
  if (Math.max(meta.width, meta.height) > TEX) {
    const s = sharp(src).resize(TEX, TEX, { fit: "inside" });
    bytes = await (png ? s.png() : s.jpeg({ quality: 90 })).toBuffer();
  }
  const pad = (4 - (len % 4)) % 4;
  if (pad) { parts.push(Buffer.alloc(pad)); len += pad; }
  gltf.bufferViews.push({ buffer: 0, byteOffset: len, byteLength: bytes.length });
  parts.push(bytes);
  len += bytes.length;
  img.bufferView = gltf.bufferViews.length - 1;
  img.mimeType = png ? "image/png" : "image/jpeg";
  console.log(`image ${img.uri}: ${meta.width}×${meta.height} → ${(bytes.length / 1e3).toFixed(0)} kB`);
  delete img.uri;
}
gltf.buffers = [{ byteLength: len }];

const bin = Buffer.concat([...parts, Buffer.alloc((4 - (len % 4)) % 4)]);
let json = Buffer.from(JSON.stringify(gltf));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const ch = (n, t) => { const b = Buffer.alloc(8); b.writeUInt32LE(n, 0); b.write(t, 4, "latin1"); return b; };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, Buffer.concat([header, ch(json.length, "JSON"), json, ch(bin.length, "BIN\0"), bin]));
console.log(`wrote ${output} (${(fs.statSync(output).size / 1e6).toFixed(2)} MB)`);

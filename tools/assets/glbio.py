"""Minimal GLB read/write helpers for the asset build scripts (Python 3 + numpy + Pillow)."""
import io, json, struct
import numpy as np
from PIL import Image

CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8, 5122: np.int16, 5120: np.int8}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def load(path):
    b = open(path, "rb").read()
    magic, _, _ = struct.unpack("<4sII", b[:12])
    assert magic == b"glTF", f"{path} is not a GLB"
    off, js, binc = 12, None, b""
    while off < len(b):
        cl, ct = struct.unpack("<I4s", b[off:off + 8])
        data = b[off + 8:off + 8 + cl]
        if ct == b"JSON":
            js = json.loads(data)
        elif ct == b"BIN\x00":
            binc = data
        off += 8 + cl
    return js, binc


def node_matrix(n):
    if "matrix" in n:
        return np.array(n["matrix"], dtype=float).reshape(4, 4).T
    t = n.get("translation", [0, 0, 0]); x, y, z, w = n.get("rotation", [0, 0, 0, 1]); s = n.get("scale", [1, 1, 1])
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R * np.array(s); M[:3, 3] = t
    return M


def read_accessor(js, binc, i):
    a = js["accessors"][i]; v = js["bufferViews"][a["bufferView"]]
    dt = np.dtype(CT[a["componentType"]]); n = NC[a["type"]]
    off = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = v.get("byteStride", 0) or dt.itemsize * n
    count = a["count"]
    raw = np.frombuffer(binc, dtype=np.uint8, count=stride * (count - 1) + dt.itemsize * n, offset=off)
    arr = np.lib.stride_tricks.as_strided(raw, shape=(count, dt.itemsize * n), strides=(stride, 1)).copy().view(dt).reshape(count, n)
    if a.get("normalized"):
        arr = arr.astype(np.float32) / np.iinfo(dt).max
    return arr


def image_bytes(js, binc, image_index):
    im = js["images"][image_index]; v = js["bufferViews"][im["bufferView"]]
    o = v.get("byteOffset", 0)
    return binc[o:o + v["byteLength"]], im.get("mimeType", "image/png")


def resize_image(data, mime, max_size, force_jpeg=False):
    """Downscale to max_size (keeps format; PNG with alpha stays PNG)."""
    img = Image.open(io.BytesIO(data))
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    if max(img.size) <= max_size and not force_jpeg:
        return data, mime
    if max(img.size) > max_size:
        img = img.resize((max_size, max_size) if img.size[0] == img.size[1] else
                         (max_size, int(img.size[1] * max_size / img.size[0])) if img.size[0] >= img.size[1] else
                         (int(img.size[0] * max_size / img.size[1]), max_size), Image.LANCZOS)
    out = io.BytesIO()
    if has_alpha and not force_jpeg:
        img.save(out, "PNG", optimize=True); return out.getvalue(), "image/png"
    img.convert("RGB").save(out, "JPEG", quality=88, optimize=True)
    return out.getvalue(), "image/jpeg"


class GlbBuilder:
    """Accumulates buffer views/accessors and writes a single-buffer GLB."""

    def __init__(self):
        self.bin = bytearray(); self.views = []; self.accessors = []

    def _view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target:
            v["target"] = target
        self.bin.extend(data); self.views.append(v)
        return len(self.views) - 1

    def add_accessor(self, arr, kind, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        comp = {np.dtype(np.float32): 5126, np.dtype(np.uint32): 5125, np.dtype(np.uint16): 5123}[arr.dtype]
        acc = {"bufferView": self._view(arr.tobytes(), target), "componentType": comp,
               "count": int(arr.shape[0]), "type": kind}
        if minmax:
            acc["min"] = arr.min(0).tolist(); acc["max"] = arr.max(0).tolist()
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def add_image(self, data, mime):
        return {"bufferView": self._view(data), "mimeType": mime}

    def write(self, path, gltf):
        gltf["buffers"] = [{"byteLength": len(self.bin)}]
        gltf["bufferViews"] = self.views; gltf["accessors"] = self.accessors
        j = json.dumps(gltf, separators=(",", ":")).encode()
        j += b" " * ((4 - len(j) % 4) % 4)
        b = bytes(self.bin) + b"\0" * ((4 - len(self.bin) % 4) % 4)
        total = 12 + 8 + len(j) + 8 + len(b)
        with open(path, "wb") as f:
            f.write(struct.pack("<4sII", b"glTF", 2, total))
            f.write(struct.pack("<I4s", len(j), b"JSON")); f.write(j)
            f.write(struct.pack("<I4s", len(b), b"BIN\x00")); f.write(b)

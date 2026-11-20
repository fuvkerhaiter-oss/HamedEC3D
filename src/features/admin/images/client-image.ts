"use client";
/** Browser-side helpers: validation, dimensions, compression of oversized images, XHR upload with progress. */

export const ACCEPT = "image/webp,image/jpeg,image/png,image/avif";
const TYPES = new Set(ACCEPT.split(","));
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024; // what we accept from disk before compression
export const MAX_SEND_BYTES = 10 * 1024 * 1024; // server limit
const MAX_EDGE = 2400;
const MIN_EDGE = 100;

export interface Inspected {
  ok: boolean;
  error?: string;
  width: number;
  height: number;
}

export async function inspectImage(file: File): Promise<Inspected> {
  if (!TYPES.has(file.type)) return { ok: false, error: "Use WebP, JPEG, PNG or AVIF", width: 0, height: 0 };
  if (file.size > MAX_SOURCE_BYTES) return { ok: false, error: `Larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MB`, width: 0, height: 0 };
  try {
    const bmp = await createImageBitmap(file);
    const { width, height } = bmp;
    bmp.close();
    if (width < MIN_EDGE || height < MIN_EDGE) return { ok: false, error: `Too small (${width}×${height}, min ${MIN_EDGE}px)`, width, height };
    return { ok: true, width, height };
  } catch {
    return { ok: false, error: "This browser can't read this image", width: 0, height: 0 };
  }
}

/** Downscale/re-encode before upload when the image is huge (saves bandwidth; the server normalizes anyway). */
export async function compressIfNeeded(file: File, dims: { width: number; height: number }): Promise<Blob> {
  const tooBig = file.size > 3 * 1024 * 1024 || Math.max(dims.width, dims.height) > MAX_EDGE;
  if (!tooBig) return file;
  const scale = Math.min(1, MAX_EDGE / Math.max(dims.width, dims.height));
  const w = Math.round(dims.width * scale), h = Math.round(dims.height * scale);
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.88));
  return blob && blob.size < file.size ? blob : file;
}

export interface UploadResult {
  ok: boolean;
  status: number;
  body: { error?: string; image?: unknown; productId?: string };
}

/** multipart POST with upload progress (fetch has no upload progress events). */
export function uploadWithProgress(url: string, fields: Record<string, string | Blob>, fileName: string, onProgress: (pct: number) => void): Promise<UploadResult> {
  return new Promise((resolve) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v instanceof Blob) fd.append(k, v, fileName.replace(/\.[^.]+$/, "") + (v.type === "image/webp" ? ".webp" : ""));
      else fd.append(k, v);
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body: UploadResult["body"] = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = { error: `Upload failed (HTTP ${xhr.status})` };
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, body: { error: "Network error — nothing was changed" } });
    xhr.send(fd);
  });
}

export const kb = (n: number | null | undefined) => (n == null ? "—" : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

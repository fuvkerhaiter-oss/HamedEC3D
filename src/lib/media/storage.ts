/**
 * Product media storage (server only).
 * - "supabase": Supabase Storage bucket `products`, written with the server-side secret key (never sent to the browser).
 * - "local": DEVELOPMENT ONLY fallback when Supabase keys are absent — files on local disk, served by /api/media.
 *   Disabled in production.
 */
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export const PRODUCT_BUCKET = "products";
export const LOCAL_BUCKET = "local";

export interface StoredObject {
  key: string; // {productId}/{file}.webp
  createdAt: Date | null;
}

export interface MediaStorage {
  readonly driver: "supabase" | "local";
  /** Value stored in product_images.bucket. */
  readonly bucket: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** Objects under one product folder (or all product folders when prefix is ""). */
  list(prefix: string): Promise<StoredObject[]>;
}

/** Object keys we create: {uuid}/{uuid}.webp — strictly validated wherever a key comes back in. */
export const OBJECT_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/;

export function localMediaDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOCAL_MEDIA_DIR ?? path.join(env.LOCALAPPDATA ?? os.tmpdir(), "megamarket-media");
}

function supabaseStorage(url: string, secret: string): MediaStorage {
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = () => client.storage.from(PRODUCT_BUCKET);
  return {
    driver: "supabase",
    bucket: PRODUCT_BUCKET,
    async put(key, data, contentType) {
      // Unique names → long immutable caching is safe; replacing an image writes a NEW key.
      const { error } = await bucket().upload(key, data, { contentType, cacheControl: "31536000", upsert: false });
      if (error) throw new Error(`Storage upload failed: ${error.message}`);
    },
    async remove(keys) {
      if (!keys.length) return;
      const { error } = await bucket().remove(keys);
      if (error) throw new Error(`Storage delete failed: ${error.message}`);
    },
    async list(prefix) {
      const folders = prefix ? [prefix.replace(/\/$/, "")] : [];
      if (!prefix) {
        const { data, error } = await bucket().list("", { limit: 1000 });
        if (error) throw new Error(error.message);
        folders.push(...(data ?? []).filter((d) => !d.id).map((d) => d.name)); // folders have no id
      }
      const out: StoredObject[] = [];
      for (const f of folders) {
        const { data, error } = await bucket().list(f, { limit: 1000 });
        if (error) throw new Error(error.message);
        for (const o of data ?? []) if (o.id) out.push({ key: `${f}/${o.name}`, createdAt: o.created_at ? new Date(o.created_at) : null });
      }
      return out;
    },
  };
}

function localStorage(dir: string): MediaStorage {
  const abs = (key: string) => {
    if (!OBJECT_KEY.test(key)) throw new Error("Invalid object key");
    return path.join(dir, ...key.split("/"));
  };
  return {
    driver: "local",
    bucket: LOCAL_BUCKET,
    async put(key, data) {
      const file = abs(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data, { flag: "wx" });
    },
    async remove(keys) {
      for (const k of keys) await rm(abs(k), { force: true });
    },
    async list(prefix) {
      const folders = prefix ? [prefix.replace(/\/$/, "")] : await readdir(dir).catch(() => [] as string[]);
      const out: StoredObject[] = [];
      for (const f of folders) {
        const files = await readdir(path.join(dir, f)).catch(() => [] as string[]);
        for (const name of files) {
          const key = `${f}/${name}`;
          if (!OBJECT_KEY.test(key)) continue;
          const s = await stat(path.join(dir, f, name)).catch(() => null);
          out.push({ key, createdAt: s?.mtime ?? null });
        }
      }
      return out;
    },
  };
}

export interface MediaStatus {
  driver: "supabase" | "local" | "none";
  detail: string;
}

export function mediaStatus(env: NodeJS.ProcessEnv = process.env): MediaStatus {
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
    return { driver: "supabase", detail: `Supabase Storage, bucket “${PRODUCT_BUCKET}”.` };
  }
  // Production builds use local storage only with an explicit test opt-in (Playwright e2e). Never set this on a server.
  if (env.NODE_ENV !== "production" || env.MEDIA_STORAGE === "local-test-only") {
    return { driver: "local", detail: "Development fallback: images are saved on this computer (not Supabase) because NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY are not set." };
  }
  return { driver: "none", detail: "Image storage is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY." };
}

export function getMediaStorage(env: NodeJS.ProcessEnv = process.env): MediaStorage | null {
  const s = mediaStatus(env);
  if (s.driver === "supabase") return supabaseStorage(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SECRET_KEY!);
  if (s.driver === "local") return localStorage(localMediaDir(env));
  return null;
}

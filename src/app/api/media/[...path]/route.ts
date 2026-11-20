import { readFile } from "node:fs/promises";
import path from "node:path";
import { localMediaDir, mediaStatus, OBJECT_KEY } from "@/lib/media/storage";

/**
 * DEVELOPMENT ONLY: serves product images saved by the local media driver (used when Supabase Storage keys
 * are not configured). In production images come from Supabase Storage and this route returns 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (mediaStatus().driver !== "local") return new Response("Not found", { status: 404 });
  const key = (await params).path.join("/");
  if (!OBJECT_KEY.test(key)) return new Response("Not found", { status: 404 });
  try {
    const data = await readFile(path.join(localMediaDir(), ...key.split("/")));
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

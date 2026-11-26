import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isCrossSiteRequest } from "@/lib/security/headers";

export async function middleware(request: NextRequest) {
  // Site-wide CSRF guard: refuse state-changing requests sent from another site (before any session work).
  if (isCrossSiteRequest(request.method, request.nextUrl.pathname, request.headers)) {
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static assets (.svg, .png, .jpg, .jpeg, .gif, .webp, .glb, .gltf, .mp3, .wasm)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb|gltf|mp3|wasm)$).*)",
  ],
};

/** A shopper opened a renter's product in the 3D store (counted for the renter's dashboard). */
import { NextResponse } from "next/server";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { recordView } from "@/lib/tenants/service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (isDbConfigured() && !rateLimited(`shop-view:${clientIp(req)}`, 120, 60_000)) {
    try {
      await recordView(getSql(), id);
    } catch (e) {
      console.error("[shop product view]", e);
    }
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

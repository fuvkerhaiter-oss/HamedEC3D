import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Continue even if already signed out
  }

  const referer = request.headers.get("referer");
  const origin = new URL(request.url).origin;
  const redirectTarget = referer && referer.startsWith(origin) ? referer : "/";

  return NextResponse.redirect(new URL(redirectTarget, origin), { status: 303 });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Validates that a redirect path is safe and local to prevent open-redirect attacks.
 */
export function sanitizeRedirect(urlOrPath: string | null | undefined, fallback = "/account"): string {
  if (!urlOrPath) return fallback;
  const trimmed = urlOrPath.trim();
  // Must start with exactly one "/" and not followed by another "/" or "\"
  if (/^\/[^/\\]/.test(trimmed) || trimmed === "/") {
    return trimmed;
  }
  return fallback;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeRedirect(requestUrl.searchParams.get("next"), "/account");
  const error = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");

  if (error) {
    const errorUrl = new URL(next, requestUrl.origin);
    errorUrl.searchParams.set("auth_error", errorDescription || error || "Authentication was cancelled or failed");
    return NextResponse.redirect(errorUrl);
  }

  if (code) {
    try {
      const supabase = await createClient();
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        const errorUrl = new URL(next, requestUrl.origin);
        errorUrl.searchParams.set("auth_error", exchangeError.message);
        return NextResponse.redirect(errorUrl);
      }
    } catch {
      const errorUrl = new URL(next, requestUrl.origin);
      errorUrl.searchParams.set("auth_error", "Failed to complete authentication exchange");
      return NextResponse.redirect(errorUrl);
    }
  }

  // Redirect to requested safe page
  return NextResponse.redirect(new URL(next, requestUrl.origin));
}

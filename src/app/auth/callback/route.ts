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

function redirectWithError(origin: string, next: string, message: string): NextResponse {
  const errorUrl = new URL(next, origin);
  errorUrl.searchParams.set("auth_error", message);
  return NextResponse.redirect(errorUrl);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeRedirect(requestUrl.searchParams.get("next"), "/account");
  const error = requestUrl.searchParams.get("error");
  const errorCode = requestUrl.searchParams.get("error_code");
  const errorDescription = requestUrl.searchParams.get("error_description");

  if (error || errorCode) {
    return redirectWithError(
      requestUrl.origin,
      next,
      errorDescription || error || errorCode || "Authentication was cancelled or failed",
    );
  }

  if (!code) {
    // Nothing to exchange — send the visitor back without inventing an error.
    return NextResponse.redirect(new URL(next, requestUrl.origin));
  }

  // Create the success response first so the Supabase server client can write
  // the session cookies straight onto it. Cookies set through `cookies()`
  // alone are not guaranteed to survive this redirect.
  const response = NextResponse.redirect(new URL(next, requestUrl.origin));

  try {
    const supabase = await createClient(response);
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      console.error("[auth/callback] code exchange failed:", exchangeError.message);
      return redirectWithError(requestUrl.origin, next, exchangeError.message);
    }
  } catch (err) {
    console.error("[auth/callback] unexpected exchange failure:", err);
    return redirectWithError(
      requestUrl.origin,
      next,
      "Failed to complete authentication exchange",
    );
  }

  return response;
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Supabase PKCE auth codes are UUIDs. */
const AUTH_CODE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function updateSession(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // The callback route must own its response so a session refresh here can
  // never overwrite the cookies written by the PKCE code exchange.
  if (pathname === "/auth/callback") {
    return NextResponse.next({ request });
  }

  // Supabase falls back to the project's Site URL when the exact callback URL
  // is not in the redirect allow-list. Forward a returned OAuth code (or a
  // provider error) to /auth/callback so sign-in still completes.
  const code = searchParams.get("code");
  const providerError = searchParams.get("error");
  const hasPkceVerifier = request.cookies.getAll().some((cookie) => cookie.name.endsWith("-code-verifier"));
  const isAuthCode = Boolean(code && AUTH_CODE_PATTERN.test(code));
  const isProviderError = Boolean(providerError && searchParams.get("error_description"));

  if ((isAuthCode && hasPkceVerifier) || isProviderError) {
    const callbackUrl = request.nextUrl.clone();
    callbackUrl.pathname = "/auth/callback";
    // Leave `next` unset: the callback reads the destination saved in the
    // wego-auth-next cookie (falls back to /account), not the Site URL path.
    callbackUrl.searchParams.delete("next");
    return NextResponse.redirect(callbackUrl);
  }

  let supabaseResponse = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !url.startsWith("http") || url.includes("placeholder")) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT: Keep getUser() here to refresh session cookies.
  await supabase.auth.getUser();

  return supabaseResponse;
}

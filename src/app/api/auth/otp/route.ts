import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { createClient, isSupabaseServerConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SendOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

const VerifyOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  token: z.string().trim().regex(/^\d{6}$/, "Code must be 6 digits"),
});

const SMTP_SEND_FAILURE = /error sending (confirmation email|magic link|email)/i;

/** Supabase's raw SMTP error is not actionable for customers. */
function friendlySendError(message: string): string {
  if (SMTP_SEND_FAILURE.test(message)) {
    return "We couldn't deliver the verification email. Please try again in a few minutes, or contact support@wegoshiiip.com if it keeps failing.";
  }
  if (/rate limit/i.test(message)) {
    return "Too many verification emails were requested. Please wait a few minutes and try again.";
  }
  return message;
}

/**
 * POST /api/auth/otp — Send an OTP code or verify an entered code.
 * Includes rate-limiting to protect against abuse.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const json = await req.json().catch(() => null);

  // If token is present, this is a verification request
  if (json && "token" in json) {
    if (rateLimited(`otp-verify:${ip}`, 10, 60_000)) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait a minute.", retryAfterSeconds: 60 },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }

    const parsed = VerifyOtpSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }

    if (!isSupabaseServerConfigured()) {
      return NextResponse.json({
        error: "Authentication service is not configured yet. Please configure Supabase Auth credentials.",
      }, { status: 503 });
    }

    try {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.verifyOtp({
        email: parsed.data.email,
        token: parsed.data.token,
        type: "email",
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        user: { id: data.user?.id, email: data.user?.email },
      });
    } catch {
      return NextResponse.json({ error: "Failed to verify code. Please try again." }, { status: 500 });
    }
  }

  // Otherwise, this is a send OTP request
  if (rateLimited(`otp-send:${ip}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "Too many code requests. Please wait a minute.", retryAfterSeconds: 60 },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const parsed = SendOtpSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 });
  }

  if (rateLimited(`otp-email:${parsed.data.email}`, 3, 60_000)) {
    return NextResponse.json(
      { error: "Too many attempts for this email. Please wait a minute.", retryAfterSeconds: 60 },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({
      error: "Authentication service is not configured yet. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
      unconfigured: true,
    }, { status: 503 });
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: {
        shouldCreateUser: true,
      },
    });

    if (error) {
      console.error("[auth/otp] Supabase could not send verification email", {
        code: error.code,
        status: error.status,
        message: error.message,
      });
      return NextResponse.json({ error: friendlySendError(error.message) }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: "Verification code sent successfully.",
    });
  } catch {
    return NextResponse.json({ error: "Failed to send code. Please try again." }, { status: 500 });
  }
}

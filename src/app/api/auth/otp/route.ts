import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimitedShared } from "@/lib/rate-limit";
import { createClient, createAdminClient, isSupabaseServerConfigured } from "@/lib/supabase/server";
import { getEmailProvider } from "@/lib/email/provider";
import { authOtpEmail } from "@/lib/email/templates";

export const dynamic = "force-dynamic";

const SendOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

const VerifyOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  token: z.string().trim().regex(/^\d{6,8}$/, "Code must be 6 to 8 digits"),
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
    if (await rateLimitedShared(`otp-verify:${ip}`, 10, 60_000)) {
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
      let { data, error } = await supabase.auth.verifyOtp({
        email: parsed.data.email,
        token: parsed.data.token,
        type: "email",
      });

      // If generic type 'email' failed, attempt 'magiclink' or 'signup' token types
      if (error && (error.message.includes("Token") || error.message.includes("expired") || error.message.includes("invalid"))) {
        const magicFallback = await supabase.auth.verifyOtp({
          email: parsed.data.email,
          token: parsed.data.token,
          type: "magiclink",
        });
        if (!magicFallback.error) {
          data = magicFallback.data;
          error = null;
        } else {
          const signupFallback = await supabase.auth.verifyOtp({
            email: parsed.data.email,
            token: parsed.data.token,
            type: "signup",
          });
          if (!signupFallback.error) {
            data = signupFallback.data;
            error = null;
          }
        }
      }

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
  if (await rateLimitedShared(`otp-send:${ip}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "Too many code requests. Please wait a minute.", retryAfterSeconds: 60 },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const parsed = SendOtpSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 });
  }

  if (await rateLimitedShared(`otp-email:${parsed.data.email}`, 3, 60_000)) {
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

  // Strategy 1: Direct Resend Delivery via Supabase Admin API
  // If SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY are configured,
  // generate the OTP via admin API and send directly with Resend.
  // This bypasses Supabase SMTP relay entirely, avoiding strict rate limits and SMTP configuration issues.
  const admin = createAdminClient();
  const emailProvider = getEmailProvider();

  if (admin && emailProvider) {
    try {
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: parsed.data.email,
      });

      if (linkError) {
        console.warn("[auth/otp] admin.generateLink error, falling back to signInWithOtp:", {
          message: linkError.message,
          status: linkError.status,
        });
      } else if (linkData?.properties?.email_otp) {
        const otp = linkData.properties.email_otp;
        const { subject, text, html } = authOtpEmail(otp);
        await emailProvider.send({
          to: parsed.data.email,
          subject,
          text,
          html,
        });

        return NextResponse.json({
          success: true,
          message: "Verification code sent successfully.",
          otpLength: otp.length,
        });
      }
    } catch (adminErr) {
      console.warn("[auth/otp] Direct Resend delivery failed, falling back to signInWithOtp:", adminErr);
    }
  }

  // Strategy 2: Fallback to Supabase built-in mailer / Custom SMTP
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
        hint: "To bypass Supabase SMTP issues, provide SUPABASE_SECRET_KEY and RESEND_API_KEY in environment variables, or check Supabase Dashboard -> Authentication -> SMTP Settings (sender must be bare email address like orders@wegoshiiip.com, not 'Name <email>').",
      });
      return NextResponse.json({
        error: friendlySendError(error.message),
        ...(process.env.NODE_ENV !== "production" ? { debugMessage: error.message } : {}),
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: "Verification code sent successfully.",
      otpLength: 8,
    });
  } catch {
    return NextResponse.json({ error: "Failed to send code. Please try again." }, { status: 500 });
  }
}

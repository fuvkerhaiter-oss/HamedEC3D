"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { login, revokeSession } from "@/lib/admin/auth";
import { logActivity } from "@/lib/admin/audit";
import { ADMIN_COOKIE, clientIp, type ActionResult } from "@/lib/admin/guard";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { rateLimitedShared } from "@/lib/rate-limit";

const Creds = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200), otp: z.string().trim().max(40).optional(), next: z.string().optional() });

const LOGIN_ERRORS: Record<string, string> = {
  locked: "Too many attempts. This account is locked for a few minutes.",
  inactive: "This admin account is deactivated.",
  mfa_required: "Two-factor sign-in is on for this account: enter the 6-digit code from your authenticator app (or a recovery code).",
  mfa_invalid: "That authentication code is not right. Use the newest code from your app, or a recovery code.",
  mfa_unavailable: "Two-factor can't be checked right now (server key missing or changed). Use a recovery code or ask the owner to reset it.",
};

export async function loginAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  if (!isDbConfigured()) return { ok: false, error: "The admin database is not configured (DATABASE_URL)." };
  const parsed = Creds.safeParse({ email: fd.get("email"), password: fd.get("password"), otp: fd.get("otp") || undefined, next: fd.get("next") ?? undefined });
  if (!parsed.success) return { ok: false, error: "Enter your email and password." };
  const sql = getSql();
  const ip = await clientIp();
  // Shared across server instances: slows password guessing from one address (and the lockout nuisance it causes).
  if (await rateLimitedShared(`admin-login:${ip ?? "unknown"}`, 10, 15 * 60_000)) {
    return { ok: false, error: "Too many sign-in attempts from this network. Please wait 15 minutes." };
  }
  const res = await login(sql, parsed.data.email, parsed.data.password, { ip, userAgent: (await headers()).get("user-agent"), otp: parsed.data.otp });
  if (!res.ok) {
    if (res.reason === "mfa_invalid" || res.reason === "locked") {
      await logActivity(sql, null, { action: `admin.login_${res.reason}`, entity: "admin_user", entityId: null, summary: `${res.reason === "locked" ? "Sign-in refused (account locked)" : "Sign-in refused (wrong two-factor code)"}: ${parsed.data.email} from ${ip ?? "unknown"}` }).catch(() => {});
    }
    return { ok: false, error: LOGIN_ERRORS[res.reason] ?? "Email or password is incorrect." };
  }
  (await cookies()).set(ADMIN_COOKIE, res.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: res.expiresAt,
  });
  await logActivity(sql, { id: res.user.id, email: res.user.email, ip }, { action: "admin.login", entity: "admin_user", entityId: res.user.id, summary: res.user.mfaEnabled ? "Signed in (two-factor)" : "Signed in" });
  const next = parsed.data.next && /^\/admin(\/[\w\-/?=&%.]*)?$/.test(parsed.data.next) ? parsed.data.next : "/admin";
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token && isDbConfigured()) await revokeSession(getSql(), token);
  jar.delete(ADMIN_COOKIE);
  redirect("/admin/login");
}

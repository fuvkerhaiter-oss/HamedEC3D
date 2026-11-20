"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { login, revokeSession } from "@/lib/admin/auth";
import { logActivity } from "@/lib/admin/audit";
import { ADMIN_COOKIE, clientIp, type ActionResult } from "@/lib/admin/guard";
import { getSql, isDbConfigured } from "@/lib/db/client";

const Creds = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200), next: z.string().optional() });

export async function loginAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  if (!isDbConfigured()) return { ok: false, error: "The admin database is not configured (DATABASE_URL)." };
  const parsed = Creds.safeParse({ email: fd.get("email"), password: fd.get("password"), next: fd.get("next") ?? undefined });
  if (!parsed.success) return { ok: false, error: "Enter your email and password." };
  const sql = getSql();
  const ip = await clientIp();
  const res = await login(sql, parsed.data.email, parsed.data.password, { ip, userAgent: (await headers()).get("user-agent") });
  if (!res.ok) {
    return {
      ok: false,
      error: res.reason === "locked" ? "Too many attempts. This account is locked for a few minutes." : res.reason === "inactive" ? "This admin account is deactivated." : "Email or password is incorrect.",
    };
  }
  (await cookies()).set(ADMIN_COOKIE, res.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: res.expiresAt,
  });
  await logActivity(sql, { id: res.user.id, email: res.user.email, ip }, { action: "admin.login", entity: "admin_user", entityId: res.user.id, summary: "Signed in" });
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

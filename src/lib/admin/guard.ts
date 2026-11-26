/**
 * Next.js glue for admin auth: session cookie, page guards and the server-action wrapper.
 * EVERY admin page calls `requirePage(permission)` and EVERY mutation goes through `adminAction`,
 * which re-checks the session and permission on the server.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { getSql, isDbConfigured, type Sql } from "../db/client";
import type { Actor } from "./audit";
import { getSessionAdmin, type AdminSession } from "./auth";
import { ForbiddenError, type Permission } from "./permissions";
import { logError } from "../log";

export const ADMIN_COOKIE = process.env.NODE_ENV === "production" ? "__Host-mm_admin" : "mm_admin";

export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  if (!isDbConfigured()) return null;
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return getSessionAdmin(getSql(), token);
});

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const ip = h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip ? ip.slice(0, 64) : null;
}

export async function actorOf(s: AdminSession): Promise<Actor> {
  return { id: s.user.id, email: s.user.email, ip: await clientIp() };
}

/** For admin pages: redirect to login when signed out, to /admin/forbidden when the permission is missing. */
export async function requirePage(permission?: Permission): Promise<AdminSession> {
  if (!isDbConfigured()) redirect("/admin/login");
  const s = await getAdminSession();
  if (!s) redirect("/admin/login");
  if (permission && !s.permissions.has(permission)) redirect(`/admin/forbidden?p=${encodeURIComponent(permission)}`);
  return s;
}

/** For route handlers (CSV exports): returns a Response on failure. */
export async function requireApi(permission: Permission): Promise<{ session: AdminSession; sql: Sql } | Response> {
  if (!isDbConfigured()) return new Response("Database not configured", { status: 503 });
  const s = await getAdminSession();
  if (!s) return new Response("Unauthorized", { status: 401 });
  if (!s.permissions.has(permission)) return new Response("Forbidden", { status: 403 });
  return { session: s, sql: getSql() };
}

export type ActionResult<T = unknown> = { ok: true; message?: string; data?: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export class UserError extends Error {
  override name = "UserError";
}

/** Postgres errors we can show to the admin (constraint messages raised by our own triggers/functions). */
function dbMessage(err: unknown): string | null {
  const e = err as { code?: string; message?: string; constraint_name?: string };
  if (!e?.code) return null;
  if (e.code === "23505") return "That value is already in use (must be unique).";
  if (e.code === "23503") return "This record is referenced by other data and cannot be changed that way.";
  if (e.code === "23514" || e.code === "P0001") return e.message ?? "The change violates a business rule.";
  if (e.code === "22P02") return "Invalid identifier.";
  return null;
}

/**
 * Wrap a server action: authenticates, checks the permission, validates FormData with a zod schema,
 * and converts known errors into a friendly ActionResult. Unknown errors are logged, not leaked.
 */
export function adminAction<S extends z.ZodType, T>(
  permission: Permission,
  schema: S,
  handler: (input: z.infer<S>, ctx: { session: AdminSession; sql: Sql; actor: Actor }) => Promise<ActionResult<T> | void>,
) {
  return async (_prev: ActionResult<T> | null, formData: FormData): Promise<ActionResult<T>> => {
    try {
      if (!isDbConfigured()) return { ok: false, error: "Database not configured." };
      const session = await getAdminSession();
      if (!session) return { ok: false, error: "Your session has expired. Please sign in again." };
      if (!session.permissions.has(permission)) throw new ForbiddenError(permission);
      const parsed = schema.safeParse(formDataToObject(formData));
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
        return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
      }
      const res = await handler(parsed.data, { session, sql: getSql(), actor: await actorOf(session) });
      return res ?? { ok: true };
    } catch (err) {
      if (err instanceof ForbiddenError || err instanceof UserError) return { ok: false, error: err.message };
      const msg = dbMessage(err);
      if (msg) return { ok: false, error: msg };
      // redirect()/notFound() throw special errors that must propagate.
      if (err && typeof err === "object" && "digest" in err) throw err;
      logError("[admin action]", err);
      return { ok: false, error: "Something went wrong. The change was not saved." };
    }
  };
}

/** FormData → plain object. Repeated keys become arrays; File entries kept. */
export function formDataToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (k in out) out[k] = ([] as unknown[]).concat(out[k], v);
    else out[k] = v;
  }
  return out;
}

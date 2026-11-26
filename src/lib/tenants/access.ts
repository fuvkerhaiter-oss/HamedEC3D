/**
 * Who is using /seller: the signed-in customer (Supabase, JWT verified server-side) and their tenant account.
 * Every seller page and action goes through here; a tenant can only ever reach their own rows.
 */
import { cache } from "react";
import { headers } from "next/headers";
import type { z } from "zod";
import { getAuthUser } from "../supabase/server";
import { getSql, isDbConfigured, type Sql } from "../db/client";
import { logError } from "../log";
import type { LeaseRow } from "../rentals/service";
import { ensureTenant, TenantError, type TenantRow } from "./service";

export type SellerContext =
  | { kind: "signed-out" }
  | { kind: "no-db" }
  | { kind: "no-shop"; email: string | null }
  | { kind: "ok"; userId: string; email: string | null; tenant: TenantRow; leases: LeaseRow[] };

export const getSellerContext = cache(async (): Promise<SellerContext> => {
  const user = await getAuthUser();
  if (!user) return { kind: "signed-out" };
  if (!isDbConfigured()) return { kind: "no-db" };
  // Only a confirmed email may claim leases booked while signed out.
  const email = user.email && (user.email_confirmed_at || user.confirmed_at) ? user.email : null;
  const r = await ensureTenant(getSql(), user.id, email);
  if (!r) return { kind: "no-shop", email: user.email ?? null };
  return { kind: "ok", userId: user.id, email: user.email ?? null, tenant: r.tenant, leases: r.leases };
});

/**
 * For seller pages: the tenant context, or null (the layout then shows sign-in / "no shop"). Pages must call this
 * themselves: a layout's check does not protect a page's data (they render in parallel).
 */
export async function requireSeller(): Promise<Extract<SellerContext, { kind: "ok" }> | null> {
  const c = await getSellerContext();
  return c.kind === "ok" ? c : null;
}

/** Hosts of this site (a payment link pointing back here is refused). */
export async function ownHosts(): Promise<string[]> {
  const h = await headers();
  const out = new Set<string>();
  const host = (h.get("x-forwarded-host") ?? h.get("host"))?.split(":")[0];
  if (host) out.add(host);
  for (const v of [process.env.NEXT_PUBLIC_SITE_URL, process.env.SITE_URL]) {
    try {
      if (v) out.add(new URL(v).hostname);
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

export type SellerResult<T = unknown> = { ok: true; message?: string; data?: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** FormData → object (repeated keys → arrays, framework keys dropped). */
function formObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    out[k] = k in out ? ([] as unknown[]).concat(out[k], v) : v;
  }
  return out;
}

/**
 * Wrap a seller server action: signed-in tenant required, input validated with zod, known errors turned into a
 * friendly message (unknown ones logged, not leaked).
 */
export function sellerAction<S extends z.ZodType, T>(
  schema: S | (() => Promise<S>),
  handler: (input: z.infer<S>, ctx: { sql: Sql; tenant: TenantRow; userId: string }) => Promise<SellerResult<T> | void>,
) {
  return async (_prev: SellerResult<T> | null, fd: FormData): Promise<SellerResult<T>> => {
    try {
      const ctx = await getSellerContext();
      if (ctx.kind !== "ok") return { ok: false, error: ctx.kind === "signed-out" ? "Please sign in again." : "Your shop account isn't available." };
      const s = typeof schema === "function" ? await (schema as () => Promise<S>)() : schema;
      const parsed = s.safeParse(formObject(fd));
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
        return { ok: false, error: "Please check the highlighted fields.", fieldErrors };
      }
      return (await handler(parsed.data, { sql: getSql(), tenant: ctx.tenant, userId: ctx.userId })) ?? { ok: true };
    } catch (e) {
      if (e instanceof TenantError) return { ok: false, error: e.message };
      if (e && typeof e === "object" && "digest" in e) throw e; // redirect()/notFound()
      logError("[seller action]", e);
      return { ok: false, error: "Something went wrong. Nothing was changed." };
    }
  };
}

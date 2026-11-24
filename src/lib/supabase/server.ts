import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { isDbConfigured, getSql } from "../db/client";

export function isSupabaseServerConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return Boolean(url && key && url.startsWith("http") && !url.includes("placeholder"));
}

export function isSupabaseAdminConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(url && secret && url.startsWith("http") && !url.includes("placeholder"));
}

/**
 * Server-only Supabase client with admin (service_role) privileges.
 * Used for administrative actions such as programmatic OTP generation and user management.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret || !url.startsWith("http") || url.includes("placeholder")) {
    return null;
  }
  return createSupabaseClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function createClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "placeholder-anon-key";

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // The `setAll` method was called from a Server Component.
          // Ignored if middleware refreshes the session.
        }
      },
    },
  });
}

/**
 * Validates the user's JWT securely with the Supabase Auth server.
 * Never trust client headers or unverified tokens for sensitive server operations.
 */
export async function getAuthUser(): Promise<User | null> {
  if (!isSupabaseServerConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

export interface CustomerProfile {
  id: string;
  email: string | null;
  fullName: string | null;
  createdAt: string;
}

/**
 * Loads the customer's profile row from public.profiles using direct SQL or Supabase.
 */
export async function getCustomerProfile(userId: string): Promise<CustomerProfile | null> {
  if (!userId) return null;
  if (isDbConfigured()) {
    const sql = getSql();
    const [row] = await sql<{ id: string; email: string | null; full_name: string | null; created_at: Date }[]>`
      select id, email, full_name, created_at from public.profiles where id = ${userId} limit 1
    `;
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  if (isSupabaseServerConfigured()) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("profiles").select("id, email, full_name, created_at").eq("id", userId).single();
    if (error || !data) return null;
    return {
      id: data.id,
      email: data.email,
      fullName: data.full_name,
      createdAt: data.created_at,
    };
  }

  return null;
}

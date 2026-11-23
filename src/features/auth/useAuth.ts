"use client";

import { useEffect, useCallback } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useAuthStore } from "./auth-store";
import { useCart } from "@/features/cart/cart-store";

export function useAuth() {
  const { user, status, setUser } = useAuthStore();

  const syncCartWithServer = useCallback(async () => {
    try {
      const guestLines = useCart.getState().lines;
      const market = useCart.getState().market;

      const res = await fetch("/api/cart/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestLines, market }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.lines && Array.isArray(data.lines)) {
          // Update client Zustand cart with authoritative merged lines
          const setLines = (lines: typeof data.lines) => {
            useCart.setState({ lines });
          };
          setLines(data.lines);
        }
      }
    } catch {
      // Non-fatal: guest cart is preserved
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setUser(null);
      return;
    }

    const supabase = createClient();

    // Check active user
    void supabase.auth.getUser().then((res) => {
      const currentUser = res.data?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        void syncCartWithServer();
      }
    });

    // Listen to auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);

      if (event === "SIGNED_IN" && currentUser) {
        void syncCartWithServer();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setUser, syncCartWithServer]);

  const signInWithGoogle = useCallback(async (redirectTo?: string) => {
    if (!isSupabaseConfigured()) {
      throw new Error("Supabase Auth is not configured. Please add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
    }
    const supabase = createClient();
    const destination = redirectTo || window.location.pathname;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(destination)}`,
        queryParams: {
          access_type: "offline",
          prompt: "select_account",
        },
      },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      await supabase.auth.signOut();
    }
    setUser(null);
    window.location.href = "/";
  }, [setUser]);

  return {
    user,
    status,
    isAuthenticated: Boolean(user),
    signInWithGoogle,
    signOut,
  };
}

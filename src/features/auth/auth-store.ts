"use client";

import { create } from "zustand";
import type { User } from "@supabase/supabase-js";

export type AuthModalMode = "welcome" | "signin" | "signup" | "otp" | "success";

interface AuthState {
  isOpen: boolean;
  mode: AuthModalMode;
  email: string;
  user: User | null;
  status: "loading" | "authenticated" | "guest";
  openAuth: (mode?: AuthModalMode) => void;
  closeAuth: () => void;
  setMode: (mode: AuthModalMode) => void;
  setEmail: (email: string) => void;
  setUser: (user: User | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isOpen: false,
  mode: "welcome",
  email: "",
  user: null,
  status: "loading",
  openAuth: (mode = "welcome") => set({ isOpen: true, mode }),
  closeAuth: () => set({ isOpen: false }),
  setMode: (mode) => set({ mode }),
  setEmail: (email) => set({ email }),
  setUser: (user) => set({ user, status: user ? "authenticated" : "guest" }),
}));

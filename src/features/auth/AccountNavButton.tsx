"use client";

import { UserRound, LayoutDashboard, Package, MapPin, ShieldCheck, Store, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "./useAuth";
import { useAuthStore } from "./auth-store";

export function AccountNavButton({ dark = false }: { dark?: boolean }) {
  const { user, status } = useAuth();
  const openAuth = useAuthStore((s) => s.openAuth);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  if (status === "loading") {
    return (
      <div
        className={`h-9 w-9 sm:w-20 rounded-full animate-pulse ${
          dark ? "bg-white/10" : "bg-ink/5"
        }`}
        aria-hidden="true"
      />
    );
  }

  if (!user) {
    return (
      <button
        onClick={() => openAuth("welcome")}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs sm:text-sm font-semibold transition active:scale-95 ${
          dark
            ? "border border-white/20 text-white hover:bg-white/10"
            : "border border-line bg-white/80 text-ink hover:bg-sand hover:border-ink/20"
        }`}
        aria-label="Sign in or join WEGO SHIIIP"
      >
        <UserRound aria-hidden className="h-4 w-4" strokeWidth={2} />
        <span className="hidden whitespace-nowrap sm:inline">Sign in</span>
      </button>
    );
  }

  const initial = (user.email?.[0] || "U").toUpperCase();
  const name = user.user_metadata?.full_name || user.email?.split("@")[0] || "Account";

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className={`inline-flex items-center gap-2 rounded-full py-1.5 pl-2 pr-3 text-xs sm:text-sm font-semibold transition active:scale-95 ${
          dark
            ? "bg-white/10 text-white hover:bg-white/20"
            : "bg-white/80 border border-line text-ink hover:bg-white hover:border-amber"
        }`}
        aria-expanded={menuOpen}
        aria-haspopup="true"
        aria-label={`Open account menu for ${name}`}
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-amber text-xs font-bold text-ink">
          {initial}
        </span>
        <span className="hidden sm:inline max-w-[80px] truncate">{name}</span>
        <span className="text-[10px] text-ink-soft" aria-hidden="true">▼</span>
      </button>

      {menuOpen && (
        <div className="vsw-cart-pop absolute right-0 mt-2 w-48 rounded-2xl bg-white p-2 shadow-card ring-1 ring-line z-50 text-sm">
          <div className="px-3 py-2 border-b border-line">
            <p className="text-xs font-semibold text-ink truncate">{name}</p>
            <p className="text-[11px] font-mono text-ink-soft truncate">{user.email}</p>
          </div>

          <div className="py-1">
            <Link
              href="/account"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-ink hover:bg-sand transition"
            >
              <LayoutDashboard aria-hidden className="h-4 w-4" strokeWidth={2} /> Overview
            </Link>
            <Link
              href="/account/orders"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-ink hover:bg-sand transition"
            >
              <Package aria-hidden className="h-4 w-4" strokeWidth={2} /> Orders
            </Link>
            <Link
              href="/account/addresses"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-ink hover:bg-sand transition"
            >
              <MapPin aria-hidden className="h-4 w-4" strokeWidth={2} /> Saved Addresses
            </Link>
            <Link
              href="/account/security"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-ink hover:bg-sand transition"
            >
              <ShieldCheck aria-hidden className="h-4 w-4" strokeWidth={2} /> Security & Privacy
            </Link>
            {/* Shop renters manage their 3D shop (brand, products, opening) in the seller dashboard. */}
            <Link
              href="/seller"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-ink hover:bg-sand transition"
            >
              <Store aria-hidden className="h-4 w-4" strokeWidth={2} /> My rented shop
            </Link>
          </div>

          <div className="pt-1 border-t border-line">
            <form action="/auth/signout" method="POST">
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 transition"
              >
                <LogOut aria-hidden className="h-4 w-4" strokeWidth={2} /> Sign Out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const ITEMS = [
  { href: "/seller", label: "Overview", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/seller/shop", label: "Brand & shop", icon: "M4 7h16l-1.5 4.5a2 2 0 01-1.9 1.5H7.4a2 2 0 01-1.9-1.5L4 7zm1 6v7h14v-7M9 20v-4h6v4" },
  { href: "/seller/products", label: "Products", icon: "M4 7l8-4 8 4-8 4-8-4zm0 0v10l8 4 8-4V7M12 11v10" },
  { href: "/seller/payments", label: "Getting paid", icon: "M3 7h18v10H3zM3 10h18M7 14h3" },
  { href: "/seller/billing", label: "Rent & billing", icon: "M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21zM10 8h4M10 12h4" },
];

/** Dashboard navigation: sidebar on desktop, a collapsible bar on phones. */
export function SellerNav({ brand, shopLabel, open }: { brand: string; shopLabel: string | null; open: boolean }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const active = (href: string) => (href === "/seller" ? path === href : path.startsWith(href));
  const links = (
    <nav className="flex flex-col gap-1" aria-label="Shop dashboard">
      {ITEMS.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          onClick={() => setMenu(false)}
          aria-current={active(i.href) ? "page" : undefined}
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active(i.href) ? "bg-amber text-ink" : "text-white/75 hover:bg-white/10 hover:text-white"}`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={i.icon} />
          </svg>
          {i.label}
        </Link>
      ))}
    </nav>
  );
  const head = (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber">Shop dashboard</p>
      <p className="truncate font-display text-lg font-extrabold text-white">{brand}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/60">
        <span className={`h-2 w-2 rounded-full ${open ? "bg-emerald-400" : "bg-white/30"}`} aria-hidden />
        {shopLabel ? `${shopLabel} · ${open ? "Open" : "Closed"}` : "No shop right now"}
      </p>
    </div>
  );
  const foot = (
    <div className="flex flex-col gap-2 border-t border-white/10 pt-4 text-sm">
      <a href="/store" target="_blank" rel="noopener" className="btn-yellow px-4 py-2.5 text-sm">
        Visit my shop in 3D<ArrowUpRight aria-hidden className="ml-1 inline h-4 w-4 align-[-3px]" />
      </a>
      <Link href="/account" className="px-3 py-1.5 text-white/60 hover:text-white">
        My customer account
      </Link>
      <form action="/auth/signout" method="post">
        <button type="submit" className="w-full px-3 py-1.5 text-left text-white/60 hover:text-white">
          Sign out
        </button>
      </form>
    </div>
  );
  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 bg-brand-deep px-4 py-6 lg:flex">
        {head}
        <div className="flex-1">{links}</div>
        {foot}
      </aside>
      <div className="sticky top-0 z-20 bg-brand-deep px-4 py-3 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          {head}
          <button onClick={() => setMenu((m) => !m)} aria-expanded={menu} className="rounded-full px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/25">
            {menu ? "Close" : "Menu"}
          </button>
        </div>
        {menu && (
          <div className="mt-3 flex flex-col gap-4 pb-2">
            {links}
            {foot}
          </div>
        )}
      </div>
    </>
  );
}

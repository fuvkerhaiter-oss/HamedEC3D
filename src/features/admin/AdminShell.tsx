"use client";
/** Admin chrome: dark sidebar (collapsible on desktop, drawer on mobile), breadcrumbs, global search, notifications. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ADMIN_NAV, BREADCRUMB_LABELS } from "./nav";

interface Props {
  user: { name: string; email: string; roleLabel: string };
  allowed: string[];
  unread: number;
  logout: () => Promise<void>;
  children: React.ReactNode;
}

const GROUPS = ["Sell", "Operate", "Grow", "System"] as const;

function isActive(path: string, href: string) {
  return href === "/admin" ? path === "/admin" : path === href || path.startsWith(href + "/");
}

function Crumbs({ path }: { path: string }) {
  const parts = path.split("/").filter(Boolean).slice(1);
  const crumbs = [{ href: "/admin", label: "Admin" }];
  parts.forEach((p, i) => {
    const href = "/admin/" + parts.slice(0, i + 1).join("/");
    const label = BREADCRUMB_LABELS[p] ?? (/^[0-9a-f-]{36}$/.test(p) ? "Details" : decodeURIComponent(p).replace(/-/g, " "));
    crumbs.push({ href, label });
  });
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 truncate font-mono text-[11px] uppercase tracking-wider text-ink-soft">
      {crumbs.map((c, i) => (
        <span key={c.href}>
          {i > 0 && <span className="mx-1.5 opacity-50">/</span>}
          {i === crumbs.length - 1 ? <span aria-current="page" className="text-ink">{c.label}</span> : <Link href={c.href} className="hover:text-ink">{c.label}</Link>}
        </span>
      ))}
    </nav>
  );
}

export function AdminShell({ user, allowed, unread, logout, children }: Props) {
  const path = usePathname() ?? "/admin";
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a per-viewer preference
      setCollapsed(localStorage.getItem("mm-admin-collapsed") === "1");
    } catch {}
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the drawer on navigation
  useEffect(() => setMobileOpen(false), [path]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("mm-admin-collapsed", c ? "0" : "1");
      } catch {}
      return !c;
    });
  };

  const nav = ADMIN_NAV.filter((n) => allowed.includes(n.href));
  const sidebar = (compact: boolean) => (
    <div className="flex h-full flex-col">
      <div className={`flex items-center gap-2.5 px-4 py-4 ${compact ? "justify-center px-2" : ""}`}>
        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber font-display text-sm text-ink">M</span>
        {!compact && (
          <span className="min-w-0">
            <span className="block truncate font-display text-base leading-none text-cream">Mega Market</span>
            <span className="eyebrow mt-1 block !text-[9px] text-cream/50">Admin</span>
          </span>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Admin">
        {GROUPS.map((g) => {
          const items = nav.filter((n) => n.group === g);
          if (!items.length) return null;
          return (
            <div key={g} className="mt-3">
              {!compact && <p className="eyebrow px-3 pb-1 !text-[9px] text-cream/40">{g}</p>}
              <ul className="space-y-0.5">
                {items.map((n) => {
                  const active = isActive(path, n.href);
                  return (
                    <li key={n.href}>
                      <Link
                        href={n.href}
                        title={compact ? n.label : undefined}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${compact ? "justify-center px-0" : ""} ${active ? "bg-cream/10 text-cream" : "text-cream/65 hover:bg-cream/5 hover:text-cream"}`}
                      >
                        <span aria-hidden className={`w-4 text-center text-[13px] ${active ? "text-amber" : ""}`}>{n.icon}</span>
                        {!compact && <span className="truncate">{n.label}</span>}
                        {!compact && n.href === "/admin/notifications" && unread > 0 && (
                          <span className="ml-auto rounded-full bg-amber px-1.5 font-mono text-[10px] text-ink">{unread}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className={`border-t border-cream/10 p-3 ${compact ? "text-center" : ""}`}>
        {!compact && (
          <div className="mb-2 min-w-0 px-1">
            <p className="truncate text-sm text-cream">{user.name || user.email}</p>
            <p className="truncate text-xs text-cream/50">{user.roleLabel}</p>
          </div>
        )}
        <form action={logout}>
          <button className="w-full rounded-lg px-3 py-2 text-left text-xs text-cream/60 hover:bg-cream/5 hover:text-cream" title="Sign out">
            {compact ? "⎋" : "Sign out"}
          </button>
        </form>
        <Link href="/" className={`block rounded-lg px-3 py-2 text-xs text-cream/60 hover:bg-cream/5 hover:text-cream`} title="View store">
          {compact ? "↗" : "View storefront ↗"}
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-cream">
      {/* Desktop sidebar */}
      <aside className={`vsw-grid-bg fixed inset-y-0 left-0 z-30 hidden bg-ink lg:block ${collapsed ? "w-16" : "w-64"} transition-[width]`}>{sidebar(collapsed)}</aside>
      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin navigation">
          <button className="absolute inset-0 bg-ink/50" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
          <aside className="vsw-grid-bg absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-ink shadow-2xl">{sidebar(false)}</aside>
        </div>
      )}
      <div className={`${collapsed ? "lg:pl-16" : "lg:pl-64"} transition-[padding]`}>
        <header className="sticky top-0 z-20 border-b border-line bg-cream/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
            <button className="btn-ghost !px-3 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">☰</button>
            <button className="hidden rounded-lg p-1.5 text-ink-soft hover:bg-sand/60 hover:text-ink lg:block" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={collapsed}>
              {collapsed ? "»" : "«"}
            </button>
            <div className="hidden min-w-0 flex-1 sm:block"><Crumbs path={path} /></div>
            <form action="/admin/search" className="ml-auto flex min-w-0 flex-1 sm:max-w-xs" role="search">
              <input name="q" type="search" placeholder="Search orders, products, customers…" aria-label="Search the admin" className="admin-input !rounded-full !py-1.5" />
            </form>
            {allowed.includes("/admin/notifications") && (
              <Link href="/admin/notifications" className="relative rounded-full p-2 text-ink-soft hover:bg-sand/60 hover:text-ink" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
                <span aria-hidden>◔</span>
                {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-amber px-1 text-center font-mono text-[10px] leading-4 text-ink">{unread > 99 ? "99+" : unread}</span>}
              </Link>
            )}
          </div>
          <div className="px-4 pb-2 sm:hidden"><Crumbs path={path} /></div>
        </header>
        <main id="admin-main" className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}

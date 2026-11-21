"use client";
/** Admin chrome: sidebar with plain-language menu (collapsible on desktop, drawer on mobile), breadcrumbs, search, alerts, page guide. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { ADMIN_NAV, BREADCRUMB_LABELS, NAV_GROUPS, navItemFor, PAGE_GUIDES } from "./nav";

interface Props {
  user: { name: string; email: string; roleLabel: string };
  allowed: string[];
  unread: number;
  logout: () => Promise<void>;
  children: React.ReactNode;
}

const readPref = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writePref = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

function Crumbs({ path }: { path: string }) {
  const parts = path.split("/").filter(Boolean).slice(1);
  const crumbs = [{ href: "/admin", label: "Home" }];
  parts.forEach((p, i) => {
    const href = "/admin/" + parts.slice(0, i + 1).join("/");
    const label = BREADCRUMB_LABELS[p] ?? (/^[0-9a-f-]{36}$/.test(p) ? "Details" : decodeURIComponent(p).replace(/-/g, " "));
    crumbs.push({ href, label });
  });
  if (crumbs.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 truncate text-sm text-ink-soft">
      {crumbs.map((c, i) => (
        <span key={c.href}>
          {i > 0 && <span className="mx-1.5 opacity-50">›</span>}
          {i === crumbs.length - 1 ? <span aria-current="page" className="font-medium text-ink">{c.label}</span> : <Link href={c.href} className="hover:text-ink hover:underline">{c.label}</Link>}
        </span>
      ))}
    </nav>
  );
}

/** "How this page works" box shown at the top of each main page until the user hides it. */
function PageGuideBox({ href, open, onClose }: { href: string; open: boolean; onClose: () => void }) {
  const guide = PAGE_GUIDES[href];
  if (!guide || !open) return null;
  return (
    <aside aria-label="How this page works" className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sky-950 sm:p-5">
      <div className="flex items-start gap-3">
        <Icon name="help" className="mt-0.5 h-5 w-5 text-sky-700" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">How this page works</p>
          <p className="mt-1 text-sm leading-relaxed">{guide.what}</p>
          <ol className="mt-3 space-y-1.5 text-sm">
            {guide.steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sky-200 text-[11px] font-semibold text-sky-900">{i + 1}</span>
                <span>{s.replace(/^\d\.\s*/, "")}</span>
              </li>
            ))}
          </ol>
        </div>
        <button onClick={onClose} className="shrink-0 rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-medium text-sky-900 hover:border-sky-400">
          Got it, hide
        </button>
      </div>
    </aside>
  );
}

export function AdminShell({ user, allowed, unread, logout, children }: Props) {
  const path = usePathname() ?? "/admin";
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hiddenGuides, setHiddenGuides] = useState<string[] | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of per-viewer preferences
    setCollapsed(readPref("mm-admin-collapsed") === "1");
    try {
      setHiddenGuides(JSON.parse(readPref("mm-admin-hidden-guides") ?? "[]"));
    } catch {
      setHiddenGuides([]);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the drawer on navigation
  useEffect(() => setMobileOpen(false), [path]);

  const toggle = () => {
    setCollapsed((c) => {
      writePref("mm-admin-collapsed", c ? "0" : "1");
      return !c;
    });
  };

  const nav = ADMIN_NAV.filter((n) => allowed.includes(n.href));
  const current = navItemFor(path, nav);
  // The guide shows on the main page of each menu item (not on detail pages).
  const guideHref = current && current.href === path && PAGE_GUIDES[current.href] ? current.href : null;
  const guideOpen = !!guideHref && hiddenGuides !== null && !hiddenGuides.includes(guideHref);
  const setGuide = (open: boolean) => {
    if (!guideHref) return;
    const next = (hiddenGuides ?? []).filter((h) => h !== guideHref).concat(open ? [] : [guideHref]);
    setHiddenGuides(next);
    writePref("mm-admin-hidden-guides", JSON.stringify(next));
  };

  const sidebar = (compact: boolean) => (
    <div className="flex h-full flex-col">
      <Link href="/admin" className={`flex items-center gap-2.5 px-4 py-4 ${compact ? "justify-center px-2" : ""}`}>
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber font-display text-base text-ink">M</span>
        {!compact && (
          <span className="min-w-0">
            <span className="block truncate font-display text-base leading-none text-cream">Mega Market</span>
            <span className="mt-1 block text-xs text-cream/55">Shop admin</span>
          </span>
        )}
      </Link>
      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Admin">
        {NAV_GROUPS.map((g) => {
          const items = nav.filter((n) => n.group === g);
          if (!items.length) return null;
          return (
            <div key={g} className="mt-4 first:mt-1">
              {!compact && <p className="px-3 pb-1.5 text-xs font-semibold text-cream/45">{g}</p>}
              <ul className="space-y-0.5">
                {items.map((n) => {
                  const active = current?.href === n.href;
                  return (
                    <li key={n.href}>
                      <Link
                        href={n.href}
                        title={compact ? `${n.label} — ${n.hint}` : n.hint}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] transition ${compact ? "justify-center px-0" : ""} ${active ? "bg-amber text-ink" : "text-cream/75 hover:bg-cream/10 hover:text-cream"}`}
                      >
                        <Icon name={n.icon} className="h-[18px] w-[18px]" />
                        {!compact && <span className="truncate">{n.label}</span>}
                        {!compact && n.href === "/admin/notifications" && unread > 0 && (
                          <span className={`ml-auto rounded-full px-2 text-xs font-semibold ${active ? "bg-ink text-cream" : "bg-amber text-ink"}`}>{unread}</span>
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
        <Link href="/" target="_blank" className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-cream/70 hover:bg-cream/10 hover:text-cream ${compact ? "justify-center" : ""}`} title="Open your shop in a new tab">
          <Icon name="store" className="h-4 w-4" />
          {!compact && "Open my shop"}
        </Link>
        <form action={logout}>
          <button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-cream/70 hover:bg-cream/10 hover:text-cream ${compact ? "justify-center" : ""}`} title="Sign out">
            <Icon name="logout" className="h-4 w-4" />
            {!compact && "Sign out"}
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-cream">
      {/* Desktop sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-30 hidden bg-ink lg:block ${collapsed ? "w-16" : "w-64"} transition-[width]`}>{sidebar(collapsed)}</aside>
      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin navigation">
          <button className="absolute inset-0 bg-ink/50" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-ink shadow-2xl">{sidebar(false)}</aside>
        </div>
      )}
      <div className={`${collapsed ? "lg:pl-16" : "lg:pl-64"} transition-[padding]`}>
        <header className="sticky top-0 z-20 border-b border-line bg-cream/90 backdrop-blur">
          <div className="flex items-center gap-2 px-4 py-2.5 sm:gap-3 sm:px-6">
            <button className="btn-ghost !px-3 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Icon name="menu" className="h-5 w-5" /><span className="hidden sm:inline">Menu</span>
            </button>
            <button className="hidden rounded-lg p-1.5 text-ink-soft hover:bg-sand/60 hover:text-ink lg:block" onClick={toggle} aria-label={collapsed ? "Show menu names" : "Make menu smaller"} title={collapsed ? "Show menu names" : "Make menu smaller"} aria-pressed={collapsed}>
              <Icon name={collapsed ? "expand" : "collapse"} className="h-5 w-5" />
            </button>
            <div className="hidden min-w-0 flex-1 sm:block"><Crumbs path={path} /></div>
            <form action="/admin/search" className="relative ml-auto flex min-w-0 flex-1 sm:max-w-xs" role="search">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
              <input name="q" type="search" placeholder="Find an order, product, customer…" aria-label="Search the admin" className="admin-input !rounded-full !py-1.5 !pl-9" />
            </form>
            {guideHref && !guideOpen && hiddenGuides !== null && (
              <button onClick={() => setGuide(true)} className="flex items-center gap-1.5 rounded-full p-2 text-ink-soft hover:bg-sand/60 hover:text-ink" title="How does this page work?">
                <Icon name="help" className="h-5 w-5" /><span className="hidden text-sm md:inline">Help</span>
              </button>
            )}
            {allowed.includes("/admin/notifications") && (
              <Link href="/admin/notifications" className="relative rounded-full p-2 text-ink-soft hover:bg-sand/60 hover:text-ink" aria-label={`Alerts${unread ? `, ${unread} unread` : ""}`} title="Alerts">
                <Icon name="bell" className="h-5 w-5" />
                {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-amber px-1 text-center text-[10px] font-semibold leading-4 text-ink">{unread > 99 ? "99+" : unread}</span>}
              </Link>
            )}
          </div>
          <div className="px-4 pb-2 sm:hidden"><Crumbs path={path} /></div>
        </header>
        <main id="admin-main" className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">
          {guideHref && <PageGuideBox href={guideHref} open={guideOpen} onClose={() => setGuide(false)} />}
          {children}
        </main>
      </div>
    </div>
  );
}

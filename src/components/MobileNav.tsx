"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Phone section links under the header banner (the banner has no room for them). Highlights the current section. */
export function MobileNav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname() ?? "/";
  return (
    <nav aria-label="Sections" className="mx-auto mt-1.5 max-w-6xl lg:hidden">
      <ul className="flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {items.map((n) => {
          const active = path === n.href || path.startsWith(`${n.href}/`) || (n.href === "/catalog" && path.startsWith("/category/"));
          return (
            <li key={n.href} className="shrink-0">
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-9 items-center rounded-full px-3.5 text-[13px] font-semibold shadow-sm ring-1 transition active:scale-95 ${active ? "bg-ink text-amber ring-ink" : "bg-white/95 text-ink ring-ink/10"}`}
              >
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

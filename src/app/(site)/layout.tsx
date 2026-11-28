import Image from "next/image";
import { MobileNav } from "@/components/MobileNav";
import Link from "next/link";
import brandLogo from "@/assets/hero/wego-shiiip-logo.webp";
import { CartButton } from "@/components/CartButton";
import { MarketSwitch } from "@/components/MarketSwitch";
import { AccountNavButton } from "@/features/auth/AccountNavButton";
import { getStorefrontSettings, listPublishedPages } from "@/lib/storefront/settings";
import { getCatalog } from "@/lib/catalog/source";
import { GUIDES } from "@/lib/content/guides";

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center" aria-label="WEGO SHIIIP. home">
      <Image
        src={brandLogo}
        alt=""
        priority={!dark}
        sizes={dark ? "160px" : "96px"}
        className={`w-auto transition group-hover:rotate-[-3deg] group-hover:scale-105 ${dark ? "h-16" : "h-10 drop-shadow-[0_2px_4px_rgb(0_0_0/0.18)]"}`}
      />
    </Link>
  );
}

const NAV = [
  { href: "/store", label: "3D Store" },
  { href: "/catalog", label: "Catalog" },
  { href: "/rent-a-shop", label: "Rent a shop" },
  { href: "/contact", label: "Help" },
];

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [{ home }, pages, catalog] = await Promise.all([getStorefrontSettings(), listPublishedPages(), getCatalog().catch(() => null)]);
  // Crawlable links to every department that has products (the 3D store and filters are not crawlable paths).
  const departments = catalog ? catalog.categories.filter((c) => catalog.products.some((p) => p.categoryId === c.id)) : [];
  const footerShop = [...NAV.filter((n) => n.href !== "/contact"), ...departments.map((c) => ({ href: `/category/${c.slug}`, label: c.name })), ...(GUIDES.length ? [{ href: "/guides", label: "Guides" }] : [])];
  return (
    <div className="flex min-h-dvh flex-col">
      {home.announcement && <p className="bg-ink px-5 py-2 text-center text-[13px] font-medium tracking-wide text-white"><span aria-hidden className="mr-2 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-amber align-middle" />{home.announcement}</p>}
      {/* Floating golden-edged banner (public/brand/navbar-banner.webp, 9-slice in globals.css .vsw-nav-banner). */}
      <header className="sticky top-0 z-40 px-2 pt-2 sm:px-4">
        <nav className="vsw-nav-banner mx-auto flex max-w-6xl items-center justify-between gap-3 py-2 pl-7 pr-7 sm:gap-4 sm:pl-9 sm:pr-8" aria-label="Main">
          <Logo />
          <div className="hidden items-center gap-0.5 text-sm font-medium lg:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="relative whitespace-nowrap px-3.5 py-2 font-semibold text-ink/75 transition hover:text-ink after:absolute after:inset-x-3.5 after:bottom-1 after:h-[3px] after:origin-left after:scale-x-0 after:rounded-full after:bg-amber after:transition-transform after:duration-200 hover:after:scale-x-100">
                {n.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <MarketSwitch />
            <AccountNavButton />
            <CartButton />
          </div>
        </nav>
        <MobileNav items={NAV} />
      </header>
      <main className="flex-1">{children}</main>
      <footer className="bg-brand-deep text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 pb-12 pt-16 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo dark />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-white/65">An immersive 3D supermarket in your browser. Real products, delivered across Europe and the United States.</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber">Shop</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {footerShop.map((n) => (
                <li key={n.href}><Link href={n.href} className="text-white/80 transition hover:text-white hover:underline hover:decoration-amber hover:decoration-2 hover:underline-offset-4">{n.label}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber">Delivery</p>
            <ul className="mt-4 space-y-2.5 text-sm text-white/80">
              <li>European Union · EUR</li>
              <li>United States · USD</li>
              <li><Link href="/account" className="transition hover:text-white hover:underline hover:decoration-amber hover:decoration-2 hover:underline-offset-4">Your account & orders</Link></li>
              <li><Link href="/contact" className="transition hover:text-white hover:underline hover:decoration-amber hover:decoration-2 hover:underline-offset-4">Help, order tracking & contact</Link></li>
              <li><Link href="/withdraw" className="transition hover:text-white hover:underline hover:decoration-amber hover:decoration-2 hover:underline-offset-4">Withdraw from contract</Link></li>
            </ul>
            {pages.length > 0 && (
              <ul className="mt-6 space-y-2.5 text-sm">
                {pages.map((pg) => <li key={pg.slug}><Link href={`/pages/${pg.slug}`} className="text-white/80 transition hover:text-white hover:underline hover:decoration-amber hover:decoration-2 hover:underline-offset-4">{pg.title}</Link></li>)}
              </ul>
            )}
          </div>
        </div>
        <div className="bg-ink">
          <div className="mx-auto flex max-w-6xl flex-col justify-between gap-2 px-5 py-5 text-xs text-white/55 sm:flex-row">
            <p>© {new Date().getFullYear()} WEGO SHIIIP · Italy</p>
            <p className="font-semibold tracking-wide text-white/70">Happy Family, Happy Animals</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

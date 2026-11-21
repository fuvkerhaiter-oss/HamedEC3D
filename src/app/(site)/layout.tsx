import Image from "next/image";
import Link from "next/link";
import brandLogo from "@/assets/hero/wego-shiiip-logo.webp";
import { CartButton } from "@/components/CartButton";
import { MarketSwitch } from "@/components/MarketSwitch";
import { getStorefrontSettings, listPublishedPages } from "@/lib/storefront/settings";

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
  { href: "/contact", label: "Help" },
];

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [{ home }, pages] = await Promise.all([getStorefrontSettings(), listPublishedPages()]);
  return (
    <div className="flex min-h-dvh flex-col">
      {home.announcement && <p className="bg-amber px-5 py-2 text-center text-sm font-medium text-ink">{home.announcement}</p>}
      {/* Floating golden-edged banner (public/brand/navbar-banner.webp, 9-slice in globals.css .vsw-nav-banner). */}
      <header className="sticky top-0 z-40 px-2 pt-2 sm:px-4">
        <nav className="vsw-nav-banner mx-auto flex max-w-6xl items-center justify-between gap-3 py-2 pl-7 pr-7 sm:gap-4 sm:pl-9 sm:pr-8" aria-label="Main">
          <Logo />
          <div className="hidden items-center gap-1 text-sm font-medium sm:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-full px-4 py-2 text-ink-soft transition hover:bg-sand hover:text-ink">
                {n.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <MarketSwitch />
            <CartButton />
          </div>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="vsw-grid-bg relative overflow-hidden bg-ink text-cream">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 pb-8 pt-16 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo dark />
            <p className="mt-4 max-w-xs text-sm text-cream/65">An immersive 3D supermarket in your browser. Real products, delivered across Europe and the United States.</p>
          </div>
          <div>
            <p className="eyebrow text-cream/45">Shop</p>
            <ul className="mt-4 space-y-2 text-sm">
              {NAV.map((n) => (
                <li key={n.href}><Link href={n.href} className="text-cream/80 transition hover:text-amber">{n.label}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow text-cream/45">Delivery</p>
            <ul className="mt-4 space-y-2 text-sm text-cream/80">
              <li>European Union · EUR</li>
              <li>United States · USD</li>
            </ul>
            {pages.length > 0 && (
              <ul className="mt-6 space-y-2 text-sm">
                {pages.map((pg) => <li key={pg.slug}><Link href={`/pages/${pg.slug}`} className="text-cream/80 transition hover:text-amber">{pg.title}</Link></li>)}
              </ul>
            )}
          </div>
        </div>
        <p aria-hidden className="pointer-events-none select-none px-5 text-center font-display text-[18vw] leading-[0.8] text-cream/[0.06] sm:text-[15vw]">
          WEGO SHIIIP.
        </p>
        <div className="border-t border-cream/10">
          <div className="mx-auto flex max-w-6xl flex-col justify-between gap-2 px-5 py-5 text-xs text-cream/50 sm:flex-row">
            <p>© {new Date().getFullYear()} WEGO SHIIIP · Italy</p>
            <p className="eyebrow !tracking-[0.14em]">Happy Family, Happy Animals</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

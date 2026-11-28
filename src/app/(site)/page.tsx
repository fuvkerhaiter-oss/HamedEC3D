import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import brandLogo from "@/assets/hero/wego-shiiip-logo.webp";
import { Footprints, PackageCheck, ShoppingCart, type LucideIcon } from "lucide-react";
import doorsOpenBanner from "@/assets/home/doors-open-banner.webp";
import storeFirstView from "@/assets/hero/store-first-view.webp";
import { EnterStoreButton, StorePortal } from "@/features/home/StorePortal";
import { getStorefrontSettings } from "@/lib/storefront/settings";
import { getCatalog } from "@/lib/catalog/source";
import { JsonLd } from "@/components/JsonLd";
import { ProductCard } from "@/components/ProductCard";
import { categoryPath, isIndexable, organizationLd, siteUrl, websiteLd } from "@/lib/seo/site";

export const metadata: Metadata = {
  title: { absolute: "WEGO SHIIIP · Online Store & Interactive 3D Supermarket" },
  description: "Everyday finds for families and their pets. Shop the WEGO SHIIIP catalog in seconds, or walk our interactive 3D store in your browser. Prices in EUR and USD.",
  alternates: { canonical: "/" },
};

/** Public profile URLs for schema.org sameAs (comma-separated, e.g. Instagram/TikTok). Empty = none listed. */
const SOCIAL = (process.env.NEXT_PUBLIC_SOCIAL_URLS ?? "").split(",").map((s) => s.trim()).filter((s) => s.startsWith("https://"));

// Hero copy is editable in Admin → Website Content (empty fields keep the defaults below).
export const revalidate = 60;

const FEATURES: { title: string; body: string; icon: LucideIcon; dark?: boolean }[] = [
  { title: "Walk the aisles", icon: Footprints, dark: true, body: "Step into our 3D supermarket on a computer or phone and look at products on the shelf before you buy. Nothing to download." },
  { title: "Real products", icon: PackageCheck, body: "Every item on the shelves is a real product with live stock, shipped to the EU and the United States." },
  { title: "Shop your way", icon: ShoppingCart, body: "Walk the store or browse the catalog: same prices, same cart. Check out as a guest or with an account." },
];

const STEPS: { title: string; body: string; keys: string[]; touchBody: string; touchKeys: string[] }[] = [
  { title: "Enter", body: "Click into the store and look around with your mouse.", keys: ["Click"], touchBody: "Tap the store picture to step inside. Turn your phone sideways for the best view.", touchKeys: ["Tap"] },
  { title: "Explore", body: "Walk the aisles, aim at a product and press E to inspect it.", keys: ["W", "A", "S", "D", "E"], touchBody: "Use the joystick (bottom left) to walk and swipe anywhere else to look around.", touchKeys: ["Joystick", "Swipe"] },
  { title: "Add & go", body: "Add to cart from the shelf, keep exploring, check out when ready.", keys: ["C"], touchBody: "Face a product and tap the hand button to inspect it, add it, then check out from the cart.", touchKeys: ["Hand", "Cart"] },
];

/** Facts the code guarantees (no review counts, sales numbers or delivery promises). */
const TRUST = [
  { title: "Secure payment", body: "Card details go straight to Stripe, never to us." },
  { title: "Guest checkout", body: "No account needed to order." },
  { title: "14-day withdrawal (EU)", body: "Cancel online from your order page." },
  { title: "Clear prices", body: "EU prices include VAT. Shipping shown before you pay." },
];

/** Brand logo: amber halo pulsing behind it + a glow hugging the letters (globals.css .vsw-logo). */
const heroLogo = (
  <>
    <span aria-hidden className="vsw-logo-glow pointer-events-none absolute -inset-[12%] -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(255_196_61/0.55),rgb(229_169_61/0.18)_55%,transparent)] blur-2xl" />
    <Image
      src={brandLogo}
      alt=""
      priority
      sizes="(min-width: 1024px) 34rem, 90vw"
      className="vsw-logo h-auto w-full"
    />
  </>
);

export default async function HomePage() {
  const [{ home, stockAllFaces, supporters }, { categories, products }] = await Promise.all([getStorefrontSettings(), getCatalog()]);
  const site = siteUrl();
  const departments = categories
    .map((c) => ({ c, items: products.filter((p) => p.categoryId === c.id && p.status === "published") }))
    .filter((d) => d.items.length > 0);
  // Real products only on the homepage grid (never mock data presented as stock); in development the sample
  // catalog is shown, labelled by the product cards / catalog banner.
  const featured = (products.some(isIndexable) ? products.filter(isIndexable) : products).filter((p) => p.variants.some((v) => v.stockQuantity > 0)).slice(0, 8);
  return (
    <>
      <JsonLd data={[organizationLd(site, SOCIAL), websiteLd(site)]} />
      {/* Hero. Phones: headline + "Shop products" first, then a compact 3D store card; the 3D scene loads only on tap
          (StorePortal preloads it in the background on desktop only). Desktop: copy left, live store right. */}
      <section className="vsw-hero-keep relative isolate flex flex-col overflow-hidden bg-ink text-cream lg:min-h-[78svh] lg:flex-row lg:items-center">
        <div className="vsw-hero-photo relative z-0 order-2 aspect-[16/10] w-full overflow-hidden sm:aspect-[16/9] lg:absolute lg:inset-y-0 lg:right-0 lg:order-none lg:aspect-auto lg:w-[62%]">
          <StorePortal image={storeFirstView} catalog={{ categories, products, stockAllFaces, supporters }} />
        </div>
        <div aria-hidden className="vsw-grid-bg absolute inset-0 -z-20" />

        {/* Copy column: its empty space lets clicks through to the store picture behind it (desktop). */}
        <div className="pointer-events-none relative z-10 order-1 mx-auto flex w-full max-w-6xl flex-col items-start gap-4 px-5 pb-6 pt-6 sm:gap-6 sm:pb-10 lg:order-none lg:py-24 [&>*]:pointer-events-auto">
          <div aria-hidden className="vsw-hero-in relative w-[min(100%,26rem)] max-lg:hidden">{heroLogo}</div>
          <p className="vsw-hero-in flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.14em] text-amber [--d:120ms]">
            <span aria-hidden className="h-px w-8 bg-amber" />
            Happy Family, Happy Animals
          </p>
          <h1 className="vsw-hero-in max-w-xl font-display text-[2rem] leading-[1.05] text-cream sm:text-5xl [--d:240ms]">
            {home.heroTitle || "Everyday finds for families and their pets."}
          </h1>
          <p className="vsw-hero-in max-w-lg text-base leading-relaxed text-cream/75 sm:text-lg [--d:360ms]">
            {home.heroSubtitle || "Shop the catalog in seconds, or walk our 3D store right in your browser. Same products, same prices, same cart."}
          </p>
          <div className="vsw-hero-in grid w-full grid-cols-2 gap-3 [--d:480ms] sm:flex sm:w-auto">
            <Link href={featured.length ? "#in-stock" : "/catalog"} className="btn-yellow min-h-12 whitespace-nowrap px-4 py-3.5 text-center text-[15px] sm:px-6 sm:text-base">
              Shop products
            </Link>
            <EnterStoreButton className="inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-full border border-cream/35 px-4 py-3.5 text-center text-[15px] font-semibold sm:px-6 sm:text-base transition hover:border-cream/70 hover:bg-cream/10">
              Enter the 3D store
            </EnterStoreButton>
          </div>
        </div>
      </section>

      {/* Trust row: only facts the shop's code guarantees. */}
      <section aria-label="Why shop with us" className="border-b border-line bg-white">
        <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-x-4 gap-y-4 px-5 py-5 text-sm sm:py-6 lg:grid-cols-4">
          {TRUST.map((t) => (
            <li key={t.title} className="flex gap-2.5">
              <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rotate-45 bg-amber" />
              <span><b className="block font-semibold text-ink">{t.title}</b><span className="text-ink-soft">{t.body}</span></span>
            </li>
          ))}
        </ul>
      </section>

      {featured.length > 0 && (
        <section id="in-stock" aria-labelledby="in-stock-title" className="scroll-mt-20 bg-cream">
          <div className="mx-auto max-w-6xl px-5 pt-10 sm:pt-16">
            <div className="flex items-end justify-between gap-4">
              <h2 id="in-stock-title" className="font-display text-2xl sm:text-4xl">In stock now</h2>
              <Link href="/catalog" className="shrink-0 text-sm font-semibold underline-offset-4 hover:underline">See all →</Link>
            </div>
            <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              {featured.map((p) => {
                const cat = categories.find((c) => c.id === p.categoryId);
                return <li key={p.id} className="flex"><div className="flex w-full flex-col [&>article]:flex-1"><ProductCard product={p} categoryName={cat?.name} /></div></li>;
              })}
            </ul>
          </div>
        </section>
      )}

      {departments.length > 0 && (
        <section aria-labelledby="shop-departments" className="bg-cream">
          <div className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">Shop by department</p>
                <h2 id="shop-departments" className="mt-3 font-display text-3xl leading-[1.05] sm:text-5xl">Two ways to shop, one cart.</h2>
                <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft sm:text-lg">Browse the list or walk the aisles of our 3D store: same products, same prices, same cart. Prices in euro (VAT included) for the EU and in US dollars for the USA; delivery options and costs are shown at checkout for your country.</p>
              </div>
              <Link href="/catalog" className="btn-dark px-6 py-3">Shop all products</Link>
            </div>
            <ul className="mt-8 grid grid-cols-2 gap-3 sm:mt-10 lg:grid-cols-4">
              {departments.map(({ c, items }) => (
                <li key={c.id}>
                  <Link href={categoryPath(c.slug)} className="group flex h-full flex-col rounded-2xl border-2 border-ink bg-white p-4 transition hover:-translate-y-1 hover:bg-amber sm:p-5">
                    <span className="font-display text-xl sm:text-2xl">{c.name}</span>
                    <span className="mt-1 text-sm text-ink-soft group-hover:text-ink">{items.length} product{items.length === 1 ? "" : "s"}</span>
                    <span className="mt-4 line-clamp-2 text-sm text-ink-soft group-hover:text-ink">{items.slice(0, 3).map((p) => p.name).join(" · ")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-24">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">Why WEGO SHIIIP</p>
              <h2 className="mt-4 max-w-xl font-display text-3xl leading-[1.04] sm:text-5xl">
                A real store you can <span className="vsw-mark">walk through</span>.
              </h2>
            </div>
            <p className="max-w-md text-base leading-relaxed text-ink-soft sm:text-lg lg:justify-self-end">Built for the browser, stocked with real products. Wander the aisles or search the catalog: both lead to the same cart.</p>
          </div>
          {/* Feature cards, built in code (the old feature-*.webp artwork carried template text). */}
          {/* Swipe row on phones: focusable so keyboard users can scroll it too (arrow keys). */}
          <div
            tabIndex={0}
            role="region"
            aria-label="Why WEGO SHIIIP: features"
            className="-mx-5 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-4 [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:mx-0 sm:mt-14 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0"
          >
            {FEATURES.map((f) => (
              <article
                key={f.title}
                className={`flex w-[78%] shrink-0 snap-center flex-col rounded-[1.75rem] p-7 ring-[3px] ring-amber shadow-[0_14px_28px_-12px_rgb(17_21_19/0.25)] transition duration-300 hover:-translate-y-1 sm:w-auto sm:p-8 ${f.dark ? "bg-brand text-white" : "bg-white text-ink"}`}
              >
                <span
                  aria-hidden
                  className={`grid h-14 w-14 place-items-center rounded-full shadow-[inset_0_-3px_0_rgb(0_0_0/0.12)] ${f.dark ? "bg-amber text-ink" : "bg-white text-ink ring-[3px] ring-amber"}`}
                >
                  <f.icon className="h-6 w-6" strokeWidth={2} />
                </span>
                <h3 className="mt-7 font-display text-2xl leading-tight sm:text-[1.75rem]">{f.title}</h3>
                <p className={`mt-3 text-[15px] leading-relaxed ${f.dark ? "text-white/80" : "text-ink-soft"}`}>{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-ink py-14 text-white sm:py-24">
        <div className="mx-auto max-w-6xl px-5">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber">How it works</p>
              <h2 className="mt-4 font-display text-3xl sm:text-5xl">Shopping in three steps.</h2>
            </div>
            <Link href="/store" className="group inline-flex items-center gap-2 text-sm font-semibold text-white/80 transition hover:text-amber">
              Try it now <span aria-hidden className="transition group-hover:translate-x-1">→</span>
            </Link>
          </div>
          <ol className="mt-10 grid gap-8 sm:mt-14 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col border-t-2 border-white/15 pt-6 transition-colors hover:border-amber">
                <span className="font-display text-4xl leading-none text-amber sm:text-5xl">{i + 1}</span>
                <h3 className="mt-4 font-display text-2xl sm:mt-6">{s.title}</h3>
                {/* Phones/tablets get touch instructions instead of keyboard keys. */}
                <p className="mt-2 leading-relaxed text-white/70 pointer-coarse:hidden">{s.body}</p>
                <p className="mt-2 hidden leading-relaxed text-white/70 pointer-coarse:block">{s.touchBody}</p>
                {[{ keys: s.keys, cls: "flex pointer-coarse:hidden" }, { keys: s.touchKeys, cls: "hidden pointer-coarse:flex" }].map(({ keys, cls }) => (
                <div key={cls} className={`mt-auto flex-wrap gap-1.5 pt-5 sm:pt-6 ${cls}`}>
                  {keys.map((k) => (
                    <kbd key={k} className="min-w-8 rounded-md border border-white/25 border-b-[3px] bg-white/5 px-2 py-1 text-center font-mono text-xs text-white">
                      {k}
                    </kbd>
                  ))}
                </div>
                ))}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-24">
          {/* 3D "Doors are open" banner (src/assets/home/doors-open-banner.webp). Its buttons are part of the artwork;
              real links sit exactly over them (positions in % of the image, measured from the file). */}
          <div className="relative transition duration-300 hover:-translate-y-1">
            <h2 className="sr-only">Doors are open. Your next shop is a walk away.</h2>
            <Image
              src={doorsOpenBanner}
              alt=""
              sizes="(min-width: 1152px) 1104px, 96vw"
              className="h-auto w-full drop-shadow-[0_18px_28px_rgb(17_21_19/0.18)]"
            />
            <Link href="/store" aria-label="Enter the store" className="absolute rounded-full outline-none transition hover:bg-white/10 hover:shadow-[0_0_0_3px_rgb(17_21_19/0.25)] focus-visible:shadow-[0_0_0_3px_#111513] active:scale-[0.98] left-[56.2%] top-[53.1%] h-[21.6%] w-[19.1%] max-sm:top-[44%] max-sm:h-[40%]" />
            <Link href="/catalog" aria-label="Browse the catalog" className="absolute rounded-full outline-none transition hover:bg-white/10 hover:shadow-[0_0_0_3px_rgb(17_21_19/0.25)] focus-visible:shadow-[0_0_0_3px_#111513] active:scale-[0.98] left-[76.4%] top-[52.9%] h-[22%] w-[18.5%] max-sm:top-[44%] max-sm:h-[40%]" />
          </div>
        </div>
      </section>
    </>
  );
}

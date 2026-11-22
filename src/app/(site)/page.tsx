import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import brandLogo from "@/assets/hero/wego-shiiip-logo.webp";
import feature1 from "@/assets/home/feature-1.webp";
import feature2 from "@/assets/home/feature-2.webp";
import feature3 from "@/assets/home/feature-3.webp";
import doorsOpenBanner from "@/assets/home/doors-open-banner.webp";
import storeFirstView from "@/assets/hero/store-first-view.webp";
import { StorePortal } from "@/features/home/StorePortal";
import { getStorefrontSettings } from "@/lib/storefront/settings";
import { getCatalog } from "@/lib/catalog/source";
import { JsonLd } from "@/components/JsonLd";
import { ProductCard } from "@/components/ProductCard";
import { categoryPath, isIndexable, organizationLd, siteUrl, websiteLd } from "@/lib/seo/site";

export const metadata: Metadata = {
  title: { absolute: "WEGO SHIIIP · Online Store & Interactive 3D Supermarket" },
  description: "Shop real products online at WEGO SHIIIP, by list or by walking an interactive 3D supermarket in your browser. Prices in EUR and USD, delivered across the EU and the USA.",
  alternates: { canonical: "/" },
};

/** Public profile URLs for schema.org sameAs (comma-separated, e.g. Instagram/TikTok). Empty = none listed. */
const SOCIAL = (process.env.NEXT_PUBLIC_SOCIAL_URLS ?? "").split(",").map((s) => s.trim()).filter((s) => s.startsWith("https://"));

// Hero copy is editable in Admin → Website Content (empty fields keep the defaults below).
export const revalidate = 60;

const FEATURES = [
  { title: "Walk the aisles", image: feature1 },
  { title: "Real products", image: feature2 },
  { title: "Shop your way", image: feature3 },
];

const STEPS: { title: string; body: string; keys: string[] }[] = [
  { title: "Enter", body: "Click into the store and look around with your mouse.", keys: ["Click"] },
  { title: "Explore", body: "Walk the aisles, aim at a product and press E to inspect it.", keys: ["W", "A", "S", "D", "E"] },
  { title: "Add & go", body: "Add to cart from the shelf, keep exploring, check out when ready.", keys: ["C"] },
];

// Real catalog categories + brand lines only (don't advertise departments we don't stock).
const RIBBON = ["Pantry", "Drinks", "Snacks", "Household", "Walk the aisles", "Happy Family, Happy Animals", "Delivered across the EU & USA"];

const STATS = [
  ["3D", "Walkable store"],
  ["28", "Countries served"],
  ["€ · $", "Local pricing"],
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
  const [{ home, stockAllFaces }, { categories, products }] = await Promise.all([getStorefrontSettings(), getCatalog()]);
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
      <section className="vsw-hero-keep relative isolate flex flex-col overflow-hidden bg-ink text-cream lg:min-h-[88svh] lg:flex-row lg:items-center">
        {/* Phones: the logo comes first, then the store picture, then the copy (the h1 below is screen-reader only there). */}
        <div aria-hidden className="vsw-hero-in relative z-10 mx-auto w-[min(86%,26rem)] pb-6 pt-8 lg:hidden">{heroLogo}</div>
        {/* The real first view of the 3D store (rendered from the scene: tools/assets/capture-store-preview.ts).
            Click = fly into the store. Between the logo and the copy on phones, right-anchored on large screens. */}
        <div className="vsw-hero-photo relative z-0 aspect-[4/3] w-full overflow-hidden lg:absolute lg:inset-y-0 lg:right-0 lg:aspect-auto lg:w-[62%]">
          <StorePortal image={storeFirstView} catalog={{ categories, products, stockAllFaces }} />
        </div>
        <div aria-hidden className="vsw-grid-bg absolute inset-0 -z-20" />

        {/* Copy column: its empty space lets clicks through to the store picture behind it. */}
        <div className="pointer-events-none relative z-10 mx-auto flex w-full max-w-6xl flex-col items-start gap-7 px-5 pb-14 pt-8 lg:py-28 [&>*]:pointer-events-auto">
          <h1 className="vsw-hero-in relative w-[min(100%,34rem)] max-lg:sr-only [--d:120ms]">
            <span className="sr-only">{home.heroTitle || "WEGO SHIIIP: online store and interactive 3D supermarket"}</span>
            <span className="block max-lg:hidden">{heroLogo}</span>
          </h1>
          <p className="vsw-hero-in flex items-center gap-3 font-display text-xl font-semibold tracking-tight text-cream [--d:360ms] sm:text-2xl">
            <span aria-hidden className="h-px w-10 bg-amber" />
            Happy Family, Happy Animals
          </p>
          <p className="vsw-hero-in max-w-lg text-lg leading-relaxed text-cream/75 drop-shadow-[0_2px_10px_rgb(0_0_0/0.5)] [--d:480ms]">
            {home.heroSubtitle || "Step into an immersive 3D store, pick real products off the shelves and have them delivered across Europe and the USA."}
          </p>
          <div className="vsw-hero-in flex flex-wrap gap-3 [--d:600ms]">
            <Link href="/catalog" className="rounded-full border border-cream/30 bg-ink/30 px-7 py-4 font-semibold backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-cream/60 hover:bg-cream/10">
              Browse the catalog
            </Link>
          </div>
          <dl className="vsw-hero-in mt-4 grid grid-cols-3 gap-6 border-t border-cream/15 pt-6 [--d:720ms] sm:gap-10">
            {STATS.map(([value, label]) => (
              <div key={label}>
                <dt className="eyebrow text-cream/50">{label}</dt>
                <dd className="mt-1 font-display text-2xl text-cream sm:text-3xl">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Category ribbon */}
      <div aria-hidden className="overflow-hidden border-y-2 border-ink bg-amber py-3 text-ink">
        <div className="vsw-marquee">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0">
              {RIBBON.map((r) => (
                <span key={r} className="flex items-center gap-6 px-6 font-display text-lg font-semibold tracking-tight">
                  {r}
                  <span className="h-2 w-2 rotate-45 bg-ink" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {departments.length > 0 && (
        <section aria-labelledby="shop-departments" className="bg-cream">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">Shop by department</p>
                <h2 id="shop-departments" className="mt-3 font-display text-4xl leading-[1.05] sm:text-5xl">Real products, two ways to shop.</h2>
                <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft">Browse the list or walk the aisles of our 3D store: same products, same prices, same cart. Prices in euro (VAT included) for the EU and in US dollars for the USA.</p>
              </div>
              <Link href="/catalog" className="btn-dark px-6 py-3">Shop all products</Link>
            </div>
            <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {departments.map(({ c, items }) => (
                <li key={c.id}>
                  <Link href={categoryPath(c.slug)} className="group flex h-full flex-col rounded-2xl border-2 border-ink bg-white p-5 transition hover:-translate-y-1 hover:bg-amber">
                    <span className="font-display text-2xl">{c.name}</span>
                    <span className="mt-1 text-sm text-ink-soft group-hover:text-ink">{items.length} product{items.length === 1 ? "" : "s"}</span>
                    <span className="mt-4 line-clamp-2 text-sm text-ink-soft group-hover:text-ink">{items.slice(0, 3).map((p) => p.name).join(" · ")}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {featured.length > 0 && (
              <>
                <h3 className="mt-16 font-display text-2xl">In stock now</h3>
                <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
                  {featured.map((p) => {
                    const cat = categories.find((c) => c.id === p.categoryId);
                    return <li key={p.id} className="flex"><div className="flex w-full flex-col [&>article]:flex-1"><ProductCard product={p} categoryName={cat?.name} /></div></li>;
                  })}
                </ul>
              </>
            )}
          </div>
        </section>
      )}

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">Why WEGO SHIIIP</p>
              <h2 className="mt-4 max-w-xl font-display text-4xl leading-[1.04] sm:text-5xl">
                Shopping, reimagined as a <span className="vsw-mark">place you visit</span>.
              </h2>
            </div>
            <p className="max-w-md text-lg leading-relaxed text-ink-soft lg:justify-self-end">A real store with real stock, built for the browser. Wander or search; both lead to the same cart.</p>
          </div>
          {/* 3D feature cards (artwork: src/assets/home/feature-*.webp, cut from "Modern Automation Feature Cards.webp"). */}
          <div className="mt-14 grid gap-6 sm:grid-cols-3 sm:gap-4">
            {FEATURES.map((f) => (
              <Image
                key={f.title}
                src={f.image}
                alt={f.title}
                sizes="(min-width: 1152px) 370px, (min-width: 640px) 32vw, 92vw"
                className="h-auto w-full drop-shadow-[0_14px_22px_rgb(17_21_19/0.16)] transition duration-300 hover:-translate-y-1.5 hover:rotate-[-0.6deg]"
              />
            ))}
          </div>
        </div>
      </section>

      <section className="bg-ink py-24 text-white">
        <div className="mx-auto max-w-6xl px-5">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber">How it works</p>
              <h2 className="mt-4 font-display text-4xl sm:text-5xl">Three steps to a full trolley.</h2>
            </div>
            <Link href="/store" className="group inline-flex items-center gap-2 text-sm font-semibold text-white/80 transition hover:text-amber">
              Try it now <span aria-hidden className="transition group-hover:translate-x-1">→</span>
            </Link>
          </div>
          <ol className="mt-14 grid gap-10 sm:grid-cols-3 sm:gap-8">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col border-t-2 border-white/15 pt-6 transition-colors hover:border-amber">
                <span className="font-display text-5xl leading-none text-amber">{i + 1}</span>
                <h3 className="mt-6 font-display text-2xl">{s.title}</h3>
                <p className="mt-2 leading-relaxed text-white/70">{s.body}</p>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-6">
                  {s.keys.map((k) => (
                    <kbd key={k} className="min-w-8 rounded-md border border-white/25 border-b-[3px] bg-white/5 px-2 py-1 text-center font-mono text-xs text-white">
                      {k}
                    </kbd>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-5 py-24">
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

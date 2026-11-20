import Image from "next/image";
import Link from "next/link";
import heroImage from "@/assets/hero/mega-market-hero.webp";
import { getStorefrontSettings } from "@/lib/storefront/settings";

// Hero copy is editable in Admin → Website Content (empty fields keep the defaults below).
export const revalidate = 60;

const FEATURES = [
  { title: "Walk the aisles", body: "Explore a beautifully lit supermarket in first person, straight from your browser. No download." },
  { title: "Real products", body: "Everything on the shelves is a real product with live prices and stock, shipped to your door." },
  { title: "Shop your way", body: "Prefer a classic list? The full catalog and cart work on any device, any time." },
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

export default async function HomePage() {
  const { home } = await getStorefrontSettings();
  return (
    <>
      <section className="relative isolate flex flex-col overflow-hidden bg-ink text-cream lg:min-h-[88svh] lg:flex-row lg:items-center">
        {/* Photo: stacked above the copy on small screens, right-anchored and faded into ink on large ones,
            so the headline never covers the characters. Slow drift + fade-in. */}
        <div aria-hidden className="vsw-hero-photo relative -z-10 aspect-[4/3] w-full overflow-hidden lg:absolute lg:inset-y-0 lg:right-0 lg:aspect-auto lg:w-[62%]">
          <div className="vsw-hero-bg absolute inset-0">
            <Image src={heroImage} alt="" fill priority placeholder="blur" sizes="(min-width: 1024px) 62vw, 100vw" className="object-cover object-[45%_35%] lg:object-[28%_35%]" />
          </div>
          <div className="vsw-load-sweep pointer-events-none absolute inset-0" />
        </div>
        <div aria-hidden className="vsw-grid-bg absolute inset-0 -z-20" />

        <div className="mx-auto -mt-8 flex w-full max-w-6xl flex-col items-start gap-7 px-5 pb-14 lg:mt-0 lg:py-28">
          <p className="vsw-hero-in eyebrow flex items-center gap-2 rounded-full border border-cream/20 bg-ink/40 px-3.5 py-1.5 text-cream/85 backdrop-blur-sm [--d:100ms]">
            <span className="h-1.5 w-1.5 rounded-full bg-amber shadow-[0_0_10px_var(--color-amber)]" />
            {home.heroEyebrow || "The supermarket you can walk into online"}
          </p>
          <h1 className="vsw-hero-in max-w-3xl font-display text-[clamp(3.5rem,11vw,8.5rem)] font-extrabold leading-[0.88] tracking-[-0.045em] drop-shadow-[0_4px_24px_rgb(0_0_0/0.45)] [--d:220ms]">
            {home.heroTitle ? home.heroTitle : <>Mega <br /><span className="text-amber">Market.</span></>}
          </h1>
          <p className="vsw-hero-in flex items-center gap-3 font-display text-xl font-semibold tracking-tight text-cream [--d:360ms] sm:text-2xl">
            <span aria-hidden className="h-px w-10 bg-amber" />
            Happy Family, Happy Animals
          </p>
          <p className="vsw-hero-in max-w-lg text-lg leading-relaxed text-cream/75 drop-shadow-[0_2px_10px_rgb(0_0_0/0.5)] [--d:480ms]">
            {home.heroSubtitle || "Step into an immersive 3D store, pick real products off the shelves and have them delivered across Europe and the USA."}
          </p>
          <div className="vsw-hero-in flex flex-wrap gap-3 [--d:600ms]">
            <Link href="/store" className="vsw-hero-cta group inline-flex items-center gap-2 rounded-full bg-amber px-7 py-4 font-semibold text-ink shadow-[0_10px_30px_rgb(229_169_61/0.4)] transition hover:-translate-y-0.5 hover:bg-[#f0bb55]">
              Enter the store
              <span aria-hidden className="transition group-hover:translate-x-1">→</span>
            </Link>
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
      <div aria-hidden className="overflow-hidden border-y border-ink bg-amber py-3 text-ink">
        <div className="vsw-marquee">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0">
              {RIBBON.map((r) => (
                <span key={r} className="flex items-center gap-6 px-6 font-display text-lg font-semibold tracking-tight">
                  {r}
                  <span className="text-ink/40">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <section className="mx-auto max-w-6xl px-5 py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow text-brand">Why Mega Market</p>
            <h2 className="mt-3 max-w-xl font-display text-4xl leading-[1.02] sm:text-5xl">Shopping, reimagined as a place you visit.</h2>
          </div>
          <p className="max-w-sm text-ink-soft">A real store with real stock, built for the browser. Wander or search; both lead to the same cart.</p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-3">
          {FEATURES.map((f, i) => (
            <article
              key={f.title}
              className={`vsw-card group relative flex min-h-64 flex-col rounded-3xl p-7 ring-1 ${i === 0 ? "bg-brand text-cream ring-brand" : "bg-white ring-line"}`}
            >
              <span className={`eyebrow ${i === 0 ? "text-cream/60" : "text-ink-soft/70"}`}>0{i + 1}</span>
              <h3 className="mt-auto font-display text-3xl leading-tight">{f.title}</h3>
              <p className={`mt-3 ${i === 0 ? "text-cream/80" : "text-ink-soft"}`}>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-sand/50 py-24">
        <div className="mx-auto max-w-6xl px-5">
          <p className="eyebrow text-brand">How it works</p>
          <h2 className="mt-3 font-display text-4xl sm:text-5xl">Three steps to a full trolley.</h2>
          <ol className="mt-12 grid gap-px overflow-hidden rounded-3xl bg-line ring-1 ring-line sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-5 bg-cream p-8">
                <span className="font-mono text-sm text-ink-soft/70">Step {String(i + 1).padStart(2, "0")}</span>
                <h3 className="font-display text-2xl">{s.title}</h3>
                <p className="text-ink-soft">{s.body}</p>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                  {s.keys.map((k) => (
                    <kbd key={k} className="min-w-8 rounded-md border border-line border-b-[3px] bg-white px-2 py-1 text-center font-mono text-xs text-ink">
                      {k}
                    </kbd>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-24">
        <div className="vsw-grid-bg relative overflow-hidden rounded-[2rem] bg-ink px-8 py-14 text-cream sm:px-14 sm:py-20">
          <div aria-hidden className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-amber/25 blur-3xl" />
          <div aria-hidden className="absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-brand/40 blur-3xl" />
          <div className="relative flex flex-col items-start gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="eyebrow text-amber">Doors are open</p>
              <h2 className="mt-3 max-w-2xl font-display text-4xl leading-[1.02] sm:text-6xl">Your next shop is a walk away.</h2>
            </div>
            <Link href="/store" className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-cream px-7 py-4 font-semibold text-ink transition hover:-translate-y-0.5 hover:bg-white">
              Enter the store
              <span aria-hidden className="transition group-hover:translate-x-1">→</span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

# WEGO SHIIIP — SEO strategy, audit & plan

Written 2026-11-22. Covers what was audited, what is implemented in code, what still needs the owner or external
accounts, and the next 90 days. **No search volumes, difficulty scores or rankings appear here**: no keyword tool
or Search Console data was available in this session. Every such metric is marked *to validate*.

---

## 1. Business & architecture (audit)

| Item | Finding |
|---|---|
| Stack | Next.js 16 App Router (React 19), Tailwind 4, React Three Fiber / three.js 3D store, Postgres via Supabase (direct `DATABASE_URL` or Supabase REST), Stripe Checkout, Vercel hosting (ISR + cron). |
| Markets | EU (EUR, VAT incl.) + US (USD, tax at checkout). Market is a client-side switch on the **same URLs** → no duplicate currency pages. |
| Language | English only (`<html lang="en">`). |
| Catalogue (verified) | Local/dev DB: 4 categories — Pantry, Drinks, Snacks, Household — with 10 **sample** products (`is_mock`, never indexed) + 1 admin test product. Production: at least one real product, a **cat water fountain** (per PROJECT_STATUS); the full live catalogue and its categories could **not** be read from here (no production DB access). |
| Product pages | `/catalog/[slug]`, ISR 60 s, same data as the catalog grid and the 3D shelves. |
| 3D store | `/store`, client-only WebGL scene (three.js, lazy-loaded), touch controls on phones, catalog fallback when WebGL is missing. Its products/text were **not** in crawlable HTML before this pass. |
| Public routes | `/`, `/catalog`, `/catalog/[slug]`, `/category/[slug]` (new), `/guides`, `/guides/[slug]` (new), `/store`, `/contact`, `/pages/[slug]` (CMS: terms, privacy, returns, shipping, cookies, legal-notice, about). |
| Private routes | `/admin/**`, `/checkout`, `/order`, `/account/**`, `/dev/**`, `/api/**` — noindex + disallowed in robots.txt; token pages send `no-referrer` + `no-store`. |

### SEO state before this pass
- ✅ robots.ts (production only), sitemap.ts (no mock products), product canonical, product JSON-LD, mock products noindex, private pages noindex.
- ❌ Product JSON-LD "escape" was a no-op (`"<"` in JS source is `<`), so product text could break out of the script tag.
- ❌ Brand hard-coded as "WEGO SHIIIP" for every product (wrong for third-party goods).
- ❌ No category landing pages (only `?category=` filter URLs), no canonical/noindex on search/filter/sort URLs → duplicate content.
- ❌ Homepage: H1 was the logo image + "WEGO SHIIIP."; no category links, no Organization/WebSite schema, no canonical.
- ❌ `/store` had title "Store", no description, no crawlable content.
- ❌ No BreadcrumbList schema; breadcrumbs only partly visible.
- ❌ Admin "Google title/description" and brand fields existed but were never used by the storefront.
- ❌ No share image; CMS pages without descriptions; no Search Console/Bing verification hook.

## 2. Implemented (this pass)

**Technical**
- `src/lib/seo/site.ts` — canonical origin (`NEXT_PUBLIC_SITE_URL`, else Vercel production domain, never localhost in production), meta-description helper, JSON-LD builders (OnlineStore/Organization, WebSite + SearchAction, BreadcrumbList, Product, ItemList, Article), safe serializer. Unit tests `tests/unit/seo.test.ts`.
- Product JSON-LD fixed & completed: real `<` escaping, one Offer per option × currency with real price/stock, self-contained seller, absolute images, `brand` **only** when the admin set one, `aggregateRating`/`review` **only** from approved reviews (Admin → Reviews).
- Canonicals on every indexable page; `/catalog?…` search/filter/sort → `noindex, follow` + canonical to `/catalog` or `/category/<slug>`.
- Sitemap: categories with real products, products with `lastmod` (product `updated_at`) and image URLs, guides, CMS pages with `lastmod`. Never mock products, never filter URLs.
- robots.txt: unchanged policy (production only), `/_next/image` deliberately **not** blocked (product photos must be crawlable).
- Default Open Graph/Twitter image `src/app/opengraph-image.jpg` (1200×630, real store render + logo), stable PNG logo `/brand/wego-shiiip-logo.png` for schema.
- Search-engine verification via env: `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BING_SITE_VERIFICATION`. Social profiles for `sameAs`: `NEXT_PUBLIC_SOCIAL_URLS` (comma-separated https URLs).
- 404s: unknown product, category, guide, CMS page → real HTTP 404 (verified).
- Admin edits revalidate `/category/[slug]` too.

**Pages**
- Homepage: title "WEGO SHIIIP · Online Store & Interactive 3D Supermarket", descriptive (screen-reader) H1 behind the unchanged logo, new "Shop by department" section (real categories + product counts) and "In stock now" grid (real products only), Organization + WebSite schema. Hero, 3D portal and visuals unchanged.
- `/category/[slug]` (new): H1, intro (Admin → Categories description, else a factual line built from real product names), product grid, other departments, BreadcrumbList + ItemList schema; noindex while it holds no real product.
- Product page: visible breadcrumb Home › Catalog › Category › Product + schema, server-rendered "Product details" table (options, attributes, SKU, EU and US price, availability), shipping/returns links, approved reviews (if any), related products, admin SEO title/description used when set.
- `/store`: real title/description/canonical; visually-hidden HTML with the same facts as the scene (H1, how it works, department and product links) + `<noscript>` link to the catalog. The 3D experience is untouched.
- `/guides` + `/guides/[slug]` (new, Article + BreadcrumbList schema): one factual guide, "How to shop in the WEGO SHIIIP 3D store", from the store's real controls.
- Catalog: crawlable department links, better title/description. CMS pages: description, canonical, breadcrumb. Contact: canonical. Footer: department + guides + help links.
- `npm run content:legal` now also adds an **About** page draft (placeholders only; owner fills in true facts).

## 3. Keyword → page map

Seed clusters from the brief, checked against the **real** catalogue. Intent: T = transactional, C = commercial investigation, I = informational, N = navigational. Volume, difficulty and competition: **to validate** (Google Keyword Planner, Search Console after launch, or Ahrefs/Semrush).

| Cluster / example queries | Intent | Landing page | Status |
|---|---|---|---|
| **Brand**: wego shiiip, wego shiiip store, wego ship shop | N | `/` | Live. Brand spelling variants in WebSite `alternateName`. Spelling with three "i" is hard to type → watch Search Console for misspellings. |
| **3D shopping**: interactive 3d shopping, virtual supermarket online, 3d online store, virtual shopping experience | I/C | `/store` (+ `/guides/how-to-shop-the-3d-store`) | Live. Differentiator; low commercial value per visit but strong for links/PR. Home targets the brand + "online store", `/store` owns "3D/virtual" → no cannibalisation. |
| **General**: online shopping, shop online, everyday essentials, unique products online, innovative products | T (very broad) | `/catalog`, `/` | Do **not** chase head terms (dominated by marketplaces). Use only as supporting copy. |
| **Pantry / drinks / snacks / household** (e.g. "buy extra virgin olive oil online", "italian pantry staples delivered") | T | `/category/<slug>` + product pages | Pages exist; worth targeting **only once real products are live** (today's local ones are samples). |
| **Pets**: pet supplies online, cat accessories, cat water fountain, pet essentials | T/C | A real category in Admin (e.g. `pets` or `cat-supplies`) → `/category/<slug>`; product page for the fountain | **One real pet product known** (cat fountain). Create the category + description in Admin when ≥ 3–5 pet products exist; until then target the product itself ("cat water fountain", "+ filter", "quiet", "stainless" — only attributes that are true). |
| Dog accessories, interactive pet toys | T | — | **No matching products → no page.** Park until stocked. |
| **Home**: home essentials, home organization, space-saving products, useful home gadgets | T/C | `/category/household` (or a new real category) | Only "Household" exists (laundry liquid, paper towels — samples locally). No organization/gadget products → no pages yet. |
| Long-tail product queries ("<product> + size/material/use") | T | Product pages | Best near-term opportunity: unique descriptions + admin "Google title" per product. |
| Buying guides ("how to choose a cat water fountain", "how to clean a pet fountain") | I → C | `/guides/<slug>` linking to the product | Write **one** good guide per real product line, not many thin ones. |

**Cannibalisation rules**: one primary page per cluster (table above); category pages own the generic category term, product pages own product-specific terms, guides own "how to / which / vs" questions and link down to products. Filter/search URLs never compete (noindex + canonical).

## 4. Structured data — validation

Checked on the local production build (`next start`), parsed from the HTML:

| Page | JSON-LD types | Result |
|---|---|---|
| `/` | OnlineStore, WebSite | valid JSON |
| `/catalog/<real product>` | BreadcrumbList, Product (offers EUR+USD, stock) | valid JSON |
| `/catalog/<sample product>` | BreadcrumbList only (Product omitted, page noindex) | as intended |
| `/category/<slug>` | BreadcrumbList, ItemList (only with real products) | valid JSON |
| `/guides/<slug>` | Article, BreadcrumbList | valid JSON |

**Still to do (needs a public URL)**: run the live product page through Google's Rich Results Test and the Schema.org validator. Expected warnings: products **without photos** won't get rich results (Google requires `image`); missing `shippingDetails` / `hasMerchantReturnPolicy` — add once the shipping and returns policies are final (they are drafts today).

## 5. Performance (Core Web Vitals)

Not re-measured in this pass (no field data; Vercel/CrUX access needed). Last lab numbers from `tools/perf/measure-pages.ts` (headless Edge, emulated Pixel 7, fast 4G, 4× CPU, 2026-11-22): homepage first paint 1.8 s, catalog 1.1 s, product 1.3 s; 3D store LCP 4.7 s, JS 598 KB.
- Already good: ISR on home/store/product/category/guides, next/image (serves WebP; AVIF not enabled), `next/font` with `display: swap`, 3D bundle lazy-loaded only on `/store` and on demand from the homepage portal, GLBs cached 7 days.
- This pass adds no client JavaScript (all new sections are server components) and the new homepage images are below the fold (lazy).
- Open: `/catalog` is per-request (filters in the URL) → move filtering client-side or cache; 3D store LCP 4.7 s on mobile (the loading screen image is the LCP: serve a smaller mobile variant, `fetchpriority=high`); enable `images.formats: ["image/avif", "image/webp"]` after checking optimizer cost; measure INP on the catalog filters; check field data in Search Console → Core Web Vitals after launch.

## 6. International

- English only; market (EUR/USD) is a display preference on the same URL. No hreflang today (correct: one language, one URL per page).
- When a real translation is added (e.g. Italian): use locale-prefixed paths (`/it/...`) for **translated** content only, self-referencing canonicals, reciprocal `hreflang` (+ `x-default` → English), localized titles/descriptions/product text, and accurate shipping info per market. Do **not** create per-country pages that differ only by currency.

## 7. Trust & authority

- Exist: Help & contact (FAQ, order tracking, contact form), legal page templates (terms, privacy, returns with 14-day EU withdrawal, shipping, cookies, legal notice) and now an About template — **all drafts until the owner fills and publishes them** (production checkout already refuses orders until terms/privacy/returns are published).
- Reviews: only real, moderated reviews are shown/marked up. There is no customer review-submission flow yet → collect reviews after delivery (email) and approve them in Admin → Reviews.
- Never add invented testimonials, badges, "as seen in" logos, ratings or counts.
- Ethical link building: the 3D store is genuinely link-worthy — pitch to WebGL/three.js showcases, indie-web and e-commerce-innovation newsletters, Product Hunt; partner with pet-care bloggers/shelters for real product reviews (disclosed); publish the guides; local Italian business directories.

## 8. Analytics & Search Console — external setup (owner)

Nothing below is connected or verified yet.
1. **Domain**: set `NEXT_PUBLIC_SITE_URL=https://<final domain>` in Vercel (Production). Pick www or non-www and redirect the other in Vercel → Domains.
2. **Google Search Console**: add a Domain property (DNS TXT) — or URL-prefix with `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=<token>` → redeploy → verify → submit `https://<domain>/sitemap.xml`.
3. **Bing Webmaster Tools**: import from Search Console, or set `NEXT_PUBLIC_BING_SITE_VERIFICATION`.
4. **GA4**: deliberately **not** added. The site has no consent banner (only strictly necessary storage today); GA4 in the EU needs consent first (Consent Mode v2 + banner + cookie policy update). Until then, Search Console gives clicks, impressions, CTR, position, indexing and CWV without cookies; Vercel Web Analytics (cookieless) is an option for traffic.
5. **Google Merchant Center** (free listings): eligible once real products have photos, final shipping/returns policies are published and contact details are on the site. Feed via structured data/crawl first; a dedicated feed (`/feeds/google.xml`) can be added later.
6. KPIs to track monthly: organic clicks/impressions/CTR/avg. position (GSC), indexed vs. submitted URLs, crawl errors/404s, CWV (field), product-page clicks, organic conversion rate and revenue (needs GA4 or server-side order attribution).

## 9. 90-day plan

**Days 1–14 — foundation live**
- Set `NEXT_PUBLIC_SITE_URL`, verify GSC + Bing, submit sitemap, request indexing for `/`, `/store`, top products.
- Fill and publish legal pages + About; real photos and real descriptions (≥ 80–150 unique words: what it is, size/material, use, care) for every live product; admin "Google title" for top products.
- Create real categories in Admin with a 2–3 paragraph description each (e.g. the pet category if pet products are the focus).
- Rich Results Test on 3 product pages; fix warnings.

**Days 15–45 — content that matches the catalogue**
- One buying guide per real product line (e.g. "How to choose and clean a cat water fountain"), linking to the products.
- Add `shippingDetails` + `hasMerchantReturnPolicy` to the Product schema once policies are final.
- Set up Merchant Center free listings.
- Decide on consent banner → then GA4 with Consent Mode.

**Days 46–90 — authority & iteration**
- Outreach: 3D/WebGL showcases, e-commerce innovation press, pet partners (real, disclosed collaborations).
- Use GSC queries to rewrite titles/descriptions of pages with impressions but low CTR; expand pages ranking 8–20.
- Collect post-delivery reviews; display only approved ones.
- Re-measure CWV (field data) and fix the worst template first.

## 10. Risks & recommendations
- **Thin catalogue**: few real products = few indexable pages. SEO growth depends on adding real, well-described products more than on any code.
- **Brand name** "WEGO SHIIIP" vs. older "Mega Market" artwork (3D loading screen still shows "MegaMarket") → inconsistent brand signals; replace the artwork when possible.
- **Data quality**: the admin brand field is used in schema — keep it to real brand names (a local test product had a sentence typed into it).
- **Product photos** are required for product rich results and Merchant Center.
- **Draft legal pages** linked from product pages (`/pages/shipping`, `/pages/returns`) return 404 until published.
- **Production database slowness** (see PROJECT_STATUS) can make ISR refreshes slow; pages still serve cached copies.

# Project Status

## Admin home resilience + dashboard indexes (2026-11-25)
- Symptom: live super-admin `/admin` showed `(panel)/error.tsx` ("This page didn't load"), while `/admin/login` worked and wrong passwords returned the normal message. So the DB was reachable and `admin_users` was queryable; one home-page query was failing/timing out.
- Production checks (no DB credentials or Vercel logs): every table/column/enum used by the home page exists in `xgplrcvnpzjczsfnxcge`; the old `xnmgiluewsjbaqlhlfim` project has no admin tables (ruled out); REST reads are fast; `orders` full scans are fast on the current data. Exact failing query still unconfirmed.
- Fix: each home section now loads independently (`load()` in `admin/(panel)/page.tsx`); a failure is logged as `[admin home: <section>]` and that section falls back to empty values, with a "Some numbers didn't load" notice instead of blanking the page. The error page now explains the failure accurately and shows the digest; `lowStockDefault` rejects non-integer/out-of-range values.
- Fix: `AdminShell` no longer trusts `mm-admin-hidden-guides`; `features/admin/prefs.ts` parses it defensively (an object previously threw `hiddenGuides.includes is not a function` and produced Next's generic error page).
- Migration `20261129000001_admin_dashboard_performance.sql` (additive): indexes for `orders(created_at)`, `orders(is_test, created_at)`, the "new customers" first-paid aggregate (partial index on `lower(email), created_at`), `refunds(created_at)`, and `admin_notification_reads(admin_user_id)`. **Push before deploying.**
- Verified locally: poisoned localStorage still renders; renaming `refunds` makes only the summary fall back, the page renders "Hello" + the warning, and the log line names `summary`. Typecheck/lint clean, new unit tests pass.
- Owner: push the migration, deploy, then reload `/admin`. If the warning appears, the Vercel log line `[admin home: <section>]` names the failing query.

## Legal pages visible locally + CMS renderer fix (2026-11-22)
- /pages/terms etc. were 404 because no CMS pages existed in the local DB (seed never run). Ran `npm run content:legal` and published all 7 templates in the LOCAL DB only (they still contain [BRACKETS] + the TEMPLATE line). Supabase/production untouched: fill + review + publish there via Admin → Website Content.
- Renderer: new `lib/storefront/cms-body.ts` (`parseCmsBody`): "# " heading = first line only (before, a heading with text right under it turned the whole section into a giant heading), bullet runs (• / -) → real lists, short unpunctuated first line → sub-heading. Tests `tests/unit/cms-body.test.ts` (4, incl. every legal template). Checked on :3000: terms, privacy, returns render properly, footer links present, no console errors.

## Online "Withdraw from contract" function (EU CRD art. 11a) (2026-11-22)
- Migration `20261126000001_withdrawal_requests.sql` (additive: `withdrawal_requests` + `withdrawal_request_items`, RLS on, no public policies) — push BEFORE deploying.
- `lib/orders/withdrawal.ts`: EUR orders only (US → returns policy); open from payment until 14 days after the day the last parcel was delivered (+12 h grace, from `shipments.delivered_at`, fallback the `delivered` status event); whole order or chosen quantities; order row locked so items can't be withdrawn twice; reason optional. On submit: statement stored, acknowledgement (content + date/time, "don't send to the parcel's sender address") queued to the given email AND the order email, queued fulfillment jobs → `manual_review` stage `customer_withdrawal`, worker re-checks before planning AND right before submitting, admin notification. Does NOT change order status or refund: team handles it with the existing refund flow.
- `/withdraw`: without a link → email + order number (lookup API `target: "withdraw"`); with the signed order token → form + "Confirm withdrawal". Links: footer (every page), order page "Changed your mind?" section, confirmation + delivered emails, contact FAQ, returns policy text (`tools/content/legal/returns.ts`).
- Admin order page: "Customer withdrawals" card (To handle / Completed / Not accepted + note; rejecting needs a note; audit-logged; rejected statements free the items again).
- Tests: unit `withdrawal.test.ts` (5), integration `withdrawal.test.ts` (4) incl. real delivered order + expiry + worker never buys. unit 175/175, integration dropshipping 7/7, commerce-ops+orders 12/12. typecheck/lint clean, build OK.
- Checked on the local prod build (:3200, local DB): lookup form, form for order #100002, submit → confirmation, reload shows history + "already withdrawn", order page section + footer link; DB has request, outbox row (`not_configured`, no local email provider), admin notification. Not checked in the browser: the admin withdrawals card (needs an admin login), real email delivery.

## Full legal texts: Terms of Sale, Privacy Policy, Returns & Refunds (2026-11-22)
- New full templates in `tools/content/legal/{terms,privacy,returns}.ts` (≈3.6k / 2.7k / 1.7k words), used by `legal-templates.ts` → `npm run content:legal`. Written for how the store really works: Stripe (fraud screening disclosed), Supabase/Vercel/Resend, dropshipping suppliers incl. non-EU (art. 49(1)(b) + SCCs), P2P voice rooms (IP visible to peers + Google STUN), demo bots, supporters wall (consent), reviews. EU: 14-day withdrawal + Annex I(B) model form, 2-year guarantee, 30-day omnibus price rule, GPSR, ADR (no ODR link: the platform closed in July 2025). US: CCPA/CPRA + state-law section, GPC honoured, AAA arbitration with 30-day opt-out and class waiver (clickwrap via the checkout terms checkbox).
- `npm run content:legal -- --refresh-drafts` replaces the draft text of never-published template pages (overwrites unpublished edits); published pages are never touched.
- Owner: fill every [BRACKET] (company, emails, EU return address, return-cost choice, IOSS/US duties, US state law, retention), have a lawyer review, publish. **Gap:** EU law requires an online "withdraw from contract" function since 19 June 2026 (CRD art. 11a); the returns text references one in brackets but the site has none yet. Keep the "we never sell / no analytics" statements true.
- typecheck/lint clean. Not rendered in the browser (pages come from the DB; the :3000 server can't reach its database).

## Dropshipping automation engine (2026-11-22)
- Full write-up: `DROPSHIPPING.md` (audit, status mapping, setup, env vars, checklist, limits). Migration `20261125000001_dropshipping_automation.sql` (additive) — push BEFORE deploying (webhook writes `fulfillment_jobs`).
- Paid order → one job (same tx) → worker (`lib/fulfillment/worker.ts`; `after()` of webhook + `/api/cron/fulfillment`) with kill switch, payment re-check, address/country, live stock+price, backups by priority, margin/limit rules → idempotent supplier order → supplier-payment pending alert. Tracking sync (`tracking-sync.ts`) → shipped/delivered + `tracking_events`. Admin `/admin/dropshipping` (KPIs, profit, exception queue, retry/handled, rules, kill switch, supplier health, log). Customer order page shows tracking events.
- AliExpress DS API adapter (`suppliers/aliexpress/*`) — fakes only, not run against live API; never pays supplier. Alibaba = manual console. DSers not integrated. Stripe disputes now alert + hold fulfillment.
- Fixed: timed-out supplier submissions were auto-retried (double-purchase risk).
- Tests: unit 169 pass; integration dropshipping 7/7, products 3/3, rest of suite pass. typecheck clean except `store3d/wing/*` (other session). Build not run (blocked by those errors).
- Owner: push migration; set ALIEXPRESS_* + scheduler for /api/cron/fulfillment (5–15 min); add Stripe events `charge.dispute.*`; EUR↔USD rate; test order with automation OFF first.

## "Who supported us from the beginning" sign in the 3D store (2026-11-22)
- Big white, free-standing sign (green frame, amber top stripe, green footer) in the new hall beside the chained COMING SOON wing: `store3d/wing/SupportersBoard.tsx`, placed by `SUPPORTERS_STAND` in `env/extension.ts` (x 21, z 5, faces back toward the store), with a walk-blocking collider (`supportersStandCollider`, so bots avoid it too). The table (#, name, country code badge + country name) is a canvas texture with only the visible rows (redrawn once per row while scrolling). Lists longer than 9 names scroll slowly on their own (looping); within 6 m the mouse wheel scrolls it (desktop), touch gets ▲/▼ buttons on the HUD (`hud/SupportersScrollButtons.tsx`, bridge `wing/supporters-scroll.ts`). Empty list → "First supporters coming soon".
- Data: store_settings key `storefront.supporters` `{title, people:[{name, country}]}` (no migration; public-read like all `storefront.*`), validated by `lib/storefront/supporters.ts` (tests `tests/unit/supporters.test.ts`), loaded with `getStorefrontSettings` (cache key → v2) and passed to /store and the homepage hero.
- Admin: `/admin/supporters` ("Supporters wall", Setup menu), **super admins only** (`admins.manage`). Add one name + country picker, paste many ("Name, Country" per line), edit inline, reorder, remove, search; "Save and publish" → `saveSupportersAction` (audit-logged via setSetting).
- Dev-only preview: `/store?supporters-demo=30` fills the sign with labelled demo rows (ignored in production).
- Checked in the browser on the :3000 dev server: empty state and 30 demo rows (auto-scroll, scrollbar, country badges), no console errors. typecheck/lint clean · unit 168/168 · build OK. Not checked: mouse-wheel/touch-button scrolling with real input (the `?cam=` test camera disables play), and the `/admin/supporters` page in the browser. The :3000 server can't reach its database, so every admin page shows "Can't reach the database" there (known env issue; restart it from a clean shell).

## Distinct box colour per product on the 3D shelves (2026-11-22)
- Before, every product in a category shared one box colour, so neighbouring products (different name and price) looked identical. Now `buildStoreLayout` returns `colors` (productId → colour). `assignProductColors` in `lib/catalog/colors.ts` builds it with pure, deterministic greedy colouring over the shelf neighbours: blocks next to each other on the same face (same bay span with the board above or below, or the next span on the same board). It uses a 12-colour `PRODUCT_PALETTE`, with golden-angle hues past that.
- The same colour is used on the shelf (`StoreScene`), in your trolley and flights, and in other shoppers' baskets (`buildTrolleyCatalog(catalog, layout.colors)`). The category colour is only a fallback. `ProductPeek`'s UI accent still uses the category colour. Product photo faces are unchanged.
- New test `tests/unit/product-colors.test.ts` rebuilds the neighbours independently from the price tags of the real layout (bench, all faces, a crowded single category) and checks that no two different neighbours share a colour.
- Checked on the dev server (`/store?cam=-2.8,1.3,-0.3,0,-5`, face L1N): each bay is now a different colour, photos still show, and there were no console errors. typecheck/lint clean · unit 155/155 · build OK.

## 5 demo bot shoppers in the 3D store (2026-11-22)
- `store3d/bots/bots.ts` (pure, tested in `tests/unit/store-bots.test.ts`): walkable grid from the shopper's own colliders (incl. extended hall, moved fridges, pillars, chains) + flood fill from spawn, A* + string pulling, every move through `collision.step` with the same body+trolley shape. Modes: walk (waddle), look at shelves, spin, hops, "Oops!" bump with each other / keep a gap from the real shopper, dance in front of the COMING SOON chains (bot-only no-go zone under the floating updates board). Seeded RNG.
- `store3d/bots/BotShoppers.tsx`: reuses the multiplayer avatar geometry (now exported from `multiplayer/RemotePlayers.tsx`) + trolley GLB clone, antenna, tags "Bot · Lulu / Bobo / Pip / Zaza / Momo" + "demo bot · not a real shopper", speech lines. One `useFrame` for all 5, shared geometry, no per-frame allocations, no shadows on lowPower. No cart/order/stock/price access, no network.
- Runners (same day): per-persona `dash` chance; Pip (the sprinter, up to ~3.7 m/s), Lulu and Bobo break into 2–5 s runs (×2.2 speed, quicker turns, lean forward, bouncy stride, arms pumping, "Zoom!"/"Coming through!"); Zaza and Momo never run. A bump ends a run. Same grid + collision, unit-tested (unit 151/151).
- Switch `NEXT_PUBLIC_STORE_BOTS` (`on`/`off`); unset = on in `next dev`, off in production. Mounted in `StoreExperience` only while playing (not the homepage hero preview). Documented in `.env.example`.
- Checked on the running dev server (:3000) in a phone-sized pane: 5 bots moving, emoting, no console errors, ~40 fps in the pane. typecheck/lint clean · unit 150/150 · build OK. Not checked on a real phone.

## SEO foundation (2026-11-22)
- Full audit, keyword map, structured-data check, external setup and 90-day plan: **SEO_STRATEGY.md**.
- New `lib/seo/site.ts` (canonical origin incl. Vercel fallback, meta descriptions, JSON-LD builders, tests `tests/unit/seo.test.ts`), `components/JsonLd.tsx`, `components/Breadcrumbs.tsx` (visible + BreadcrumbList).
- Fixed: product JSON-LD "<" escape was a no-op; brand was hard-coded "WEGO SHIIIP" (now only the admin brand). Storefront now uses the admin brand / "Google title" / SEO description / updated_at and category descriptions (catalog loaders + Product/Category types).
- New pages: `/category/[slug]` (intro, grid, other departments, ItemList; noindex while no real product), `/guides` + `/guides/how-to-shop-the-3d-store` (Article). Product page: breadcrumb, server-rendered details table (options, SKU, EU+US price, stock), approved reviews (`lib/catalog/reviews.ts`, rating schema only from real reviews), related products. Home: descriptive H1 (sr-only, logo unchanged), "Shop by department" + "In stock now", OnlineStore + WebSite schema. `/store`: title/description/canonical + visually-hidden HTML of departments/products + noscript link (3D unchanged). Catalog search/filter/sort URLs: noindex,follow + canonical. CMS pages: description, canonical, breadcrumb. Footer: departments, guides, help.
- Sitemap: categories, product lastmod + images, guides, CMS lastmod. Share image `app/opengraph-image.jpg` (+ twitter), schema logo `public/brand/wego-shiiip-logo.png`. Env hooks: `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BING_SITE_VERIFICATION`, `NEXT_PUBLIC_SOCIAL_URLS`. About page draft added to `npm run content:legal`.
- Checked on the local production build: status codes (200/404), titles, canonicals, robots, valid JSON-LD per template, 3D store loads without console errors. typecheck/lint clean · unit 142/142 · e2e 14/14 · build OK. Not checked: Google Rich Results Test / Search Console (needs the public domain), field Core Web Vitals.
- Owner: set `NEXT_PUBLIC_SITE_URL`, verify Search Console/Bing, submit sitemap, publish legal + About pages, real photos/descriptions per product, category descriptions. GA4 deliberately not added (needs a consent banner first).

## Store extended: new hall + chained "Coming soon" wing (2026-11-22)
- Owner's request: remove the wall at the end of the market, make the market bigger, close the new place with chains (owner's Meshy iron chain FBX), a big 3D "COMING SOON" above it, and a 3D popup of feature updates when the shopper gets near.
- `env/extension.ts` (pure, tested): old far wall (x 14.1) removed, room extended 14.1 → 34.2 m (≈ +75 % floor). The two fridge banks that stood against the old wall are **moved, not deleted** (quarter turn onto the new hall's side walls), colliders follow. `STORE_ENV = extendLayout(SUPERMARKET)` is what /store and the hero use; admin keeps SUPERMARKET (shelf faces unchanged).
- `env/reshape.ts`: load-time cut/move on the cached GLB scene (once; only the affected merged meshes are rebuilt). The .glb file is unchanged.
- `wing/NewWing.tsx`: new floor/ceiling reuse the store's own materials with the same tile mapping (affine UV fit), plaster walls, instanced LED battens; portal at x 25.2 (dark-green bulkhead, amber light lines, hazard bands) with extruded beveled gold **COMING SOON** (drei Text3D, helvetiker bold in `public/fonts/`, gently pulsing glow); two crossed sagging chains + a low cordon chain (one InstancedMesh of the chain segment, `wing/chains.ts`), swaying padlock, wing interior (backlit WEGO SHIIIP wall, covered display islands, crates, work lights). Desktop adds one warm spot on the chains.
- Board upgrade (same day): hinged left wing "ON THE WAY · Play. Earn. Win." (Levels & Progression, Loyalty Points & Rewards, Exclusive Promotions, Coupons & Discount Codes, Giveaways & Special Events) with flat gold icons, swings open from behind the main board; announcements only (`ON_THE_WAY` in `wing/updates.ts`), nothing built. Board moved to the hall centre line so the open wing clears the fridges (yaw limit ±26°); the padlock is now behind the board while it is open.
- `wing/UpdatesBoard.tsx`: within 7.5 m of the chains the 3D "What's new & what's coming" board unfolds row by row (soft whoosh), floats, turns to face the shopper and folds away when they leave. Content in `wing/updates.ts`: "Just landed" = features live today; **"Coming soon" items are placeholders for the owner to confirm/edit**.
- Collision: shoppers walk through the old wall line into the hall and stop at the chains (and at the moved fridges, pillars). Unit tests `tests/unit/store-extension.test.ts`.
- Checked in headless Edge (old aisle → portal view, hall, both fridge banks, board open, padlock close-up, view back from the wing): no errors. typecheck/lint clean · unit 133/133 · build OK. Not walked with real keyboard/touch input, not checked on a phone.
- Owner: the chain originals were copied into `3D models/` (git-ignored); the copies in the project root (FBX + 4 PNGs, ~22 MB, untracked) can be deleted.

## Stripe Checkout: every cart line + webhook round-trip in test mode (2026-11-22)
- Existing integration kept (server prices via `priceOrder`, atomic stock reservation, `/api/webhooks/[provider]` with signature check + dedupe + PaymentIntent re-check, refunds, admin). Gap fixed: the Stripe session showed ONE line "Order #N"; now `startCheckout` → `orderBreakdown` sends every saved `order_items` line (name — variant, unit price, qty, https image), shipping as a Stripe shipping rate, US sales tax as its own line, the server-validated coupon as a single-use Stripe coupon, "Prices include X% VAT" for EU, billing address required, 23 h session expiry. If the breakdown doesn't add up to the order total exactly it falls back to one total line, so Stripe can never charge a different amount.
- New webhook events: `checkout.session.expired` → order cancelled + stock released (only for the order's current session; actor `payment_webhook` may now set `cancelled`, the transition table still only allows it from `pending_payment`). `payment_intent.payment_failed` → logged in `payment_events`, shown as "Declined card attempts" on the admin order; order stays open (Checkout lets the customer retry). Admin order also shows the Checkout Session id.
- Stock: unchanged design — reserved atomically at checkout (sellable = on hand − reserved), stays reserved when paid, deducted at shipment, released on cancel/refund/expiry.
- **Real Stripe test-mode run** (local DB): order #100004, 2× chocolate + 1× olive oil, coupon 10 %: Stripe page showed both lines, −1,50 €, shipping 4,90 €, total 18,37 € = server total; paid with 4242 → `checkout.session.completed` → order paid, PaymentIntent + session ids + actual Stripe fee saved, customer page "Paid · being prepared"; duplicate delivery → "duplicate"; forged signature → 400. Order #100005: card 4000…0002 declined → stays pending + logged; session expired in Stripe → cancelled, reservations released.
- How the events were delivered: no Stripe CLI here, so the REAL events were fetched from Stripe's API and posted to `/api/webhooks/stripe` signed with a local `whsec_local…` secret. Stripe's own delivery to the hosted endpoint is still untested → do it on Vercel (or `stripe listen`).
- Local `.env.local`: `PAYMENT_PROVIDER=dev-simulator` commented out (checkout uses Stripe test mode); added a local `STRIPE_WEBHOOK_SECRET` and `ORDER_LINK_SECRET`. Local coupon `STRIPETEST10` was created for the test, now inactive. Not run for real: a US order (local DB has no US shipping zone) — unit test only.
- Note: the `next dev` on :3000 that was already running uses a different DATABASE_URL from its shell environment (Supabase pooler rejects the user), so its checkout quote returns 502. Restart it from a clean shell.
- Owner: in Stripe → Webhooks add `checkout.session.expired` and `payment_intent.payment_failed`.
- typecheck/lint clean · unit 128/128 · build OK.

## Storefront redesign: black / white / yellow / dark green (2026-11-22)
- New palette tokens in `globals.css` (`ink` near-black, `cream` near-white, `amber` = signal yellow #f7c416, `brand` = forest green #12392b, + `brand-deep`, `amber-deep`) and plain button classes `.btn-yellow/.btn-dark/.btn-outline`, `.vsw-mark` highlight.
- Homepage hero is **unchanged**: its section carries `.vsw-hero-keep`, which pins the old color values (also covers the live 3D preview/fly-in inside it). The 3D store HUD on `/store` picks up the new tokens.
- Restyled: nav hover (yellow underline), announcement bar, footer (dark green + black bar), home sections below the hero (feature grid, dark "How it works", yellow closing CTA), catalog header band (green, yellow search), product cards, product page (category pill, trust row), cart drawer, help page, error/404 buttons.
- Checked in the browser (home, catalog, product, cart). typecheck + lint clean on the changed files. `next build` compiles but its type-check stops on another session's temp file `tools/_tmp_walk.ts`. Not changed by this pass.

## 3D store start / pause screen redesigned (2026-11-22)
- Owner's screenshot: key names and the title were invisible and the layout looked unfinished. New `store3d/hud/PauseMenu.tsx` (moved out of Hud.tsx), explicit colors (it sits over the 3D scene): brand header, "Welcome in / Enter the store" first, "Paused / Resume shopping" after entering; desktop legend with real keycaps (W A S D, Shift, E, C, M, V, Esc + mouse) in two columns; phones get icon rows for the thumbs/✋/cart; Settings card (Music switch, look sensitivity on touch); "List view" / "Leave store" buttons. Landscape phones: two columns with the main button at the top right; the room name panel is hidden on phones while paused so it no longer covers the card.
- Checked in Edge: desktop (first + paused), Pixel 7 landscape and portrait (tap) — main button always on screen, no errors. e2e smoke updated to the new button names, 8/8; typecheck/lint clean.
- Not changed: on narrow portrait phones the room pill and the top-right buttons (music, EU/US, cart) still crowd each other (pre-existing).

## 3D store popups show whole product photos (2026-11-22)
- Peek card (340×170) and product dialog used `object-cover`, cropping square product photos (text/infographics cut off). Now `object-contain` on white (`.vsw-peek-media-photo`, slideshow layers `bg-white`), peek photo 170 → 200 px, dialog photo min height 56 → 72 (sm). Placeholder/initial letter unchanged.
- Checked in Edge on the real store (peek + dialog): whole photo visible, no errors. typecheck/lint clean, e2e smoke 8/8.
- Stripe test keys are set in the local `.env.local` only (checked against Stripe: test account, IT, EUR). Live site: owner adds them + webhook secret in Vercel (steps in INTEGRATION_GUIDE "Stripe").

## Stock right on the product page (2026-11-22)
- Owner's live product didn't show on the 3D shelves: its only variant had **0 stock** (the 3D layout leaves an empty facing with a "Sold out" tag), and they had typed 1000 into "Low-stock alert at", thinking it was the stock. Stock could only be set on Stock (Inventory).
- Product page (`admin/(panel)/products/[id]`): each size/option now opens with a "How many you have (stock)" box + "Save stock" (same `adjustStockAction`, movement + change-history entry, reason "Set on the product page"; needs `inventory.adjust`); sold-out options open automatically; a "Nothing in stock" warning shows on live products with no sellable stock. New-variant field renamed "How many you have (stock)"; "Low-stock alert at" now says it is NOT the stock. Saving stock refreshes the shop, the 3D store and the admin page at once.
- e2e admin test extended (set 0 → warning, set 25 → gone); admin e2e 6/6, unit 122/122, typecheck/lint clean.
- Owner: set real stock for the cat fountain, and change its "Low-stock alert at" from 1000 to a small number (else it will always alert).

## Speed pass: pages served from the cache (2026-11-22)
- Measured with new `tools/perf/measure-pages.ts` (headless Edge, Pixel 7, ≈ fast 4G 9 Mbit/s / 150 ms, 4× CPU) on the local production build. First paint: home 2.2 s, catalog 1.1 s, product 1.3 s, 3D store 3.1 s (fade-in loading screen; 3.5 MB in the first 10 s). Server time locally 10–40 ms for every page.
- Biggest problem on Vercel: `/store` (force-dynamic) and `/catalog/[slug]` (no generateStaticParams) ran a server function on EVERY visit, which wakes a function and may wait on the (currently slow) Supabase database. Now both are cached (ISR, 60 s, and admin edits still refresh them at once): `/store` ○, `/catalog/[slug]` ● (rendered on first visit, then cached). Verified `x-nextjs-cache: HIT`. Only `/catalog` (filters via URL) and checkout/account/admin stay per-request.
- **Rapier physics removed** (owner OK'd): it was only used to stop the shopper + trolley walking through 22 axis-aligned boxes on a flat floor. Replaced by `store3d/collision.ts` (circle body + rotated trolley box vs rectangles, ≤ 8 cm / ≤ 0.04 rad sub-steps so nothing tunnels, push-out along the shortest way = sliding; turning the trolley into a shelf pushes the shopper back). `Player` is now a plain group; `EnvColliders`/`<Physics>` gone; `@react-three/rapier` uninstalled. Unit tests `tests/unit/collision.test.ts` (wall, slide, trolley, 90° snap turn, real layout). Walked the real store in Edge (aisle, both shelves, diagonal slide, entrance wall): never inside an obstacle, no errors.
- After: 3D store JS 1,415 → 598 KB, LCP 5.8 → 4.7 s, first 10 s 3.5 → 2.7 MB; homepage JS 1,396 → 579 KB, first paint 2.2 → 1.8 s (same emulated phone).
- Still open: `/catalog` is per-request (filters in the URL → move filtering to the browser to cache it); the Supabase database itself is slow (check in Supabase).
- typecheck/lint clean · unit 122/122 · e2e 14/14 · build OK.

## Admin 504 on Vercel: database calls can no longer hang (2026-11-22)
- Symptom: live `/admin` → Vercel 504 FUNCTION_INVOCATION_TIMEOUT. No Vercel log access from here (CLI not installed, dashboard not signed in), so the exact production trigger is unconfirmed.
- Cause found: postgres.js has no query timeout. Once a connection is open, a query on a socket that went silently dead waits forever (reproduced locally: still hanging after 30 s). On Vercel the instance is frozen between requests, so the pool's 20 s idle timer never runs while the pooler/NAT drops the idle sockets; the next request writes into a dead socket and hangs until the platform kills it. Dashboard queries themselves are fast (~0.2–0.4 s locally).
- Fix (`lib/db/client.ts` `createGuardedSql`, used by `getSql()`): every query 10 s deadline, every `sql.begin` 30 s; on a timeout the pool is replaced (next request reconnects, ~0.1 s) and the caller gets `DbTimeoutError` (`DB_TIMEOUT`, counted by `isDbUnreachable`). Connections idle > 15 s (wall clock, so it works across freezes) are replaced before reuse. connect_timeout 10 → 5 s. `createSql` (tests/tools) unchanged.
- Admin: panel layout shows a full-page "Can't reach the database right now / Try again" notice (`features/admin/DbDownNotice.tsx`) instead of hanging; other page failures show `(panel)/error.tsx` with "Try again". `maxDuration = 30` on the admin panel.
- Tests: new `tests/unit/db-guard.test.ts` (fake silent Postgres); typecheck/lint clean · unit 118/118 · build OK.
- Follow-up (same day): the next Vercel build failed prerendering `/` with `57014 canceling statement due to statement timeout` — Supabase itself cancelled the (normally millisecond) catalog query. So the production database is answering very slowly or a query is stuck behind a lock; that is most likely the real reason for the admin 504 too. `isDbUnreachable` now also counts 57014 / 57P0x, so the build prerenders without products instead of failing, and the admin shows its "can't reach the database" notice. Still open: find out why Supabase is slow (dashboard usage/health, `pg_stat_activity` for stuck queries).
- Owner to check after deploy: open /admin; if it still fails, the Vercel log line `[db] no answer from the database…` or `admin: database unreachable` says which part.

## Product photo slideshow in the 3D store popups (2026-11-22)
- Admin already had everything (product page → "Images": upload several, drag/← → to reorder, "Set main", delete, alt text; plus Admin → Product photos for bulk upload). No admin changes.
- `store3d/hud/PhotoSlideshow.tsx` (+ pure `slideshow.ts`, unit tested): peek card and product dialog crossfade through `product.gallery` (main photo first) every 2.8 s, looping; dots; dialog also has prev/next buttons, swipe (touch, `pan-y`), ←/→ only while focus is inside the dialog. Pauses on mouse hover/focus, waits for the next photo to load, stops when the popup closes, restarts from the main photo per product, no auto-advance with reduced motion. Screen readers: alt text on the visible photo, "Photo x of N" live only while paused. 0–1 photos: unchanged markup.
- Egress: same `next/image` + `canOptimize` + `sizes`; only visible, fading-out and NEXT photo mounted; no new DB reads.
- Verified in the browser (desktop + phone landscape) with a temporary 3-photo local product (removed afterwards); typecheck/lint clean · unit 117/117 · build OK. Not tested on a real iPhone.

## Phase 3 3D experience, UX & visual polish (2026-11-21)
Status: **PARTIAL** — measured asset/perf wins, visual + a11y + error-state fixes, tests green; real product models, real-device (iPhone/Android) and low-end GPU tests still open.
- **Assets** (`tools/assets/optimize-glb.mjs`, meshoptimizer dev tool, no runtime dependency): `supermarket.opt.glb` 12.6 → 2.3 MB, `trolley.opt.glb` 9.5 → 0.8 MB (162k → 32k tris, simplified 0.2 at 0.4 % error), meshopt-compressed geometry, 8-bit normals, WebP textures (same resolution). Visual diff vs. old files: mean pixel difference 0.2–4 / 255. Registry points to the .opt files; the old `supermarket.glb` / `trolley.glb` are kept until the owner approves deleting them.
- **Measured** (`tools/perf/measure-store.ts`, headless Edge + GPU, 1440×900, 3 runs each, same 4 views): models over the wire 11.1 MB (gzip) → 1.9 MB; triangles/frame 383–550k → 253–290k; JS heap 88 → 49 MB; ready 4.2 → 3.7 s on localhost; draw calls unchanged (30–105); FPS on this desktop GPU within noise (~200–400 uncapped). Homepage hero downloads the same smaller models.
- **Visual**: floor tiles were half-metallic + mirror-smooth (puffy, wet look) → polished vinyl (non-metal, roughness 0.42, faint relief). Hero still re-rendered from the live scene.
- **Rendering quality**: adaptive resolution now on every device (weak laptop GPUs → 1.25×, phones → 1×).
- **Accessibility**: product dialog takes focus and traps Tab; reduced-motion users get a still hero preview and a straight fly-in (no FOV punch/sway/bank).
- **Interactions**: "Put in trolley" can't add twice on a fast double click/tap; quantity clamped to stock.
- **States**: storefront error page (`(site)/error.tsx`), helpful 404 (`app/not-found.tsx`), catalog loading skeleton.
- Tests: typecheck/lint clean · unit 107/107 · e2e 14/14 on the production build (new: WebGL-off fallback → catalog, 404) · integration see report.
- **Open**: products on shelves are labelled placeholder boxes until real product GLBs/photos are uploaded (no fake models); no real-device test (iPhone/Android/low-end laptop); the 3D bundle JS size not reduced; draw calls from price-tag text not batched.

## Phase 2 commercial operations (2026-11-21)
Status: **PARTIAL** — code complete and tested locally; needs real Stripe test-mode run, real tax/shipping configuration, email domain, monitoring. Migration `20261124000001_commerce_operations.sql` (additive).
- **Orders** now snapshot the applied tax rate + country/state (`tax_rate_bps`, `tax_country`, `tax_region`), an optional **billing address**, and the delivery **estimate** (min/max business days). Checkout: billing section ("same as delivery" default), estimate wording "estimate, not guaranteed"; server validates US state + ZIP and postal-code shape (`lib/shipping/address.ts`); client prices/totals are stripped by the schema.
- **Fulfillment**: marking the last shipment delivered moves the order to `delivered` (emails once). Full manual flow tested end-to-end with audit log entries.
- **Emails** (outbox): + payment failed, delivered, partial refund (amount); tracking + estimate in shipped email; **dedupe_key** makes each email unique per event.
- **Reports** (Admin → Reports): order counts (total/paid/pending/cancelled/failed/refunded) and a per-order money table (products, discount, shipping, tax, refunds net, Stripe fee, supplier cost final/est., net revenue, est. profit). **Fixed**: refunds used to subtract their tax twice; refunded-before-fulfilment orders no longer get an invented supplier cost.
- **Customer order history** without accounts: `/account/orders` → email a signed 24 h link (only to the address itself, same answer for unknown addresses, 1/hour) → all that address's orders with status, tracking, refunds. Linked from Help.
- **Production**: security headers (HSTS prod, nosniff, frame, referrer; `no-referrer` + no-store on token pages), `lib/log.ts` (no query params/emails in logs), `npm run check:env` (config check by name only), production checklist in INTEGRATION_GUIDE.
- **Not done (needs decisions/services)**: real customer accounts (login, profile, saved addresses), product tax classes / US local rates / Stripe Tax, error monitoring (Sentry), distributed rate limiting, server-side cart, legal review of the draft pages.

## Other shoppers push their own trolleys (2026-11-21)
- `multiplayer/RemotePlayers.tsx`: every avatar pushes the real trolley model (arms on the handle) with its basket contents; new items drop in with a bounce, the trolley jiggles, "+N" pops over their head, label shows "N items in trolley".
- Basket travels in Realtime presence as `[productId, count][]` (`rooms.ts` `packBasket`/`cleanBasket`, ids validated, capped at 36; product ids only, no prices). `net.ts` `setMyBasket` debounces updates (350 ms).
- Verified with two headless Edge shoppers (local channel). Not yet tested with Supabase keys.

## Homepage hero = live 3D store with a 3D fly-in (2026-11-21)
- Hero (`features/home/StorePortal.tsx`) shows the real render `assets/hero/store-first-view.webp` (made by `tools/assets/capture-store-preview.ts` from the actual scene) at once, then loads the live store in the background (idle; skipped on data-saver/2G/3G and without WebGL 2 → loads on click) and crossfades to it: `StoreExperience embedded` in stage "preview" with `CinematicCamera` (slow hover behind/above the aisle). Rendering pauses when the hero is scrolled away.
- Click (or any "Enter the store" button via `mm:enter-store`): synthesized woosh (`lib/fx/whoosh.ts`), room matchmaking starts, music starts; the hero frame grows to full screen (clip-path) while the camera flies down to the shopper's eyes (swoop + FOV punch, 1.5 s), then play starts in place — no route change, no loading screen, no menu. Desktop requests pointer lock inside the click; touch enters automatically. Pause → "Leave store" returns to the live hero (`ui-store.onLeave`). `/store` unchanged for direct links.
- `ui-store.stage` (preview/entering/play) gates Player + TouchLook; HUD/rooms/rotate hint only in play. The old picture-zoom + flash navigation (PortalArrival) was removed.
- Verified with headless Edge (desktop + Pixel 7 landscape): preview renders live, fly-in frames, play with HUD/room/pointer lock, phone auto-enter with touch controls, leave → back to hero with scroll restored; no page errors. typecheck/lint clean · unit 99/99 · e2e 12/12.
- Cost: the homepage now downloads the 3D models (~22 MB, cached) after load on fast connections.

## Phase 1 security hardening — payments, refunds, fulfillment (2026-11-21)
Status: **PARTIAL** (all code checks pass; real Stripe test-mode round-trip not yet run). Migration `20261123000001_payment_fulfillment_hardening.sql` (additive).
- **CRITICAL fixed**: an order whose payment FAILED (status `failed`) could be pushed `failed → processing` → supplier (createSupplierOrders accepted `failed`; adminTransition allowed it; recordSupplierSubmission had no check). Now `requireFulfillmentEligible` (lib/orders/fulfillment-eligibility.ts) runs, under the order row lock, in createSupplierOrders, recordSupplierSubmission and admin transitions to processing/submitted_to_supplier, and re-verifies the PaymentIntent with Stripe (fails closed). DB triggers enforce the same rule.
- **Refunds**: reservation now atomic (order+payment locked → no over-refund under concurrency); partial refunds no longer move the order to `refund_requested` (used to get it stuck); provider refund status used (succeeded → settled immediately, pending → settled by `refund.*` webhooks matched by id/metadata, failed → amount released); finalizeRefund idempotent (only pending → settled); network errors keep the refund pending (no double refund); requestId per rendered form blocks double submits; refunds made in the Stripe dashboard are flagged.
- **Webhook**: Stripe PaymentIntent re-checked (pending → delivery fails and is retried; canceled/mismatch → flagged); order row locked; late payment on a cancelled order is recorded + flagged (admin must refund); unknown-order payments flagged.
- **Fees**: actual gross/fee/net/settlement currency from the balance transaction stored on `payments` (fee_amount only when same currency); cron backfills.
- Tests: unit 99/99, integration 40/40 (new payment-security.test.ts 14), SQL/RLS ok, typecheck/lint clean, build OK.
- **Owner to do**: add Stripe webhook events `refund.created`, `refund.updated`, `refund.failed`; run a Stripe TEST-mode payment + partial refund end-to-end; remaining risk: a failed FULL refund leaves the order in `refund_requested` (state machine has no way back) — retry the refund or record it manually.

## Admin made easy to understand (2026-11-21)
Owner found the admin confusing. Plain-language UX pass (no logic changes):
- **Menu** (`features/admin/nav.ts`): groups "Every day / Products / Money & delivery / Setup", plain names (Home, Alerts, Stock (Inventory), Discount codes, Reports, Shipping prices, Website text, Shop settings, Team & logins, Change history), new "Product photos" item, real SVG icons (`features/admin/icons.tsx`), hover hints.
- **"How this page works"** box on every main page (`PAGE_GUIDES` in nav.ts, shown by `AdminShell`); "Got it, hide" per page (localStorage), "Help" button brings it back.
- **Home** (`(panel)/page.tsx`): "To do now" list (orders to send, supplier problems, sold out, running low, alerts, drafts, unpaid) with action buttons, quick actions, then numbers in plain words.
- **Statuses** in plain words everywhere (`STATUS_LABEL`/`statusLabel` in `ui.tsx`, e.g. paid → "Paid – ready to send", published → "Live in shop"); hover explains order steps.
- **Orders**: tabs (Ready to send, Waiting for payment, Waiting for tracking, On the way, Refund asked); order page has a "What to do next" box per step and plain card/field names. **Product page**: 4-step "how to put a product in your shop" box, "Sizes & prices" (= variants), plain field hints.
- Verified in the browser (desktop + 375 px), typecheck/lint clean, unit 85/85, e2e admin 6/6 (prod build). E2E expectations updated for the new names.
- Not reworded yet (still somewhat technical inside the forms): inventory, shipping, discounts, settings, suppliers, payments, analytics page bodies — page guides explain them.

## Production readiness pass 1 (2026-11-21): checkout, emails, legal, help, SEO, voice mute
- **Checkout** `/checkout` → `POST /api/checkout` (`lib/checkout/service.ts` `startCheckout`): `createOrder` (server prices, atomic stock reservation, idempotent per cart key) → payment session (Stripe, or the labelled dev simulator) → redirect. Paid ONLY via verified webhook. `POST /api/checkout/quote` = live preview (shipping options, tax, coupon) via new shared `priceOrder` (createOrder now uses it). Rate-limited (`lib/rate-limit.ts`, in-memory). Unpaid orders auto-cancel after 25 h (stock released). Cart drawer "Checkout" button is live.
- **Order page** `/order?id=…&t=…` (guest, HMAC-signed link, `lib/checkout/order-link.ts`; forged token → 404): status, items, totals, tracking; auto-refreshes while the webhook arrives; empties the cart.
- **Dev payment simulator** `/dev/payment-simulator` (+ `/api/dev/payment-simulator`): development only (404 in production), signed webhook through the real path. Enabled locally in `.env.local` (`PAYMENT_PROVIDER=dev-simulator`).
- **Emails** (`lib/email/*`): Resend provider (`RESEND_API_KEY`, `EMAIL_FROM`); order confirmed / shipped / refunded / cancelled QUEUED in `email_outbox` inside the status-change transaction (`transitionOrderInDb`), sent after commit (webhook route, admin actions) + `/api/cron/maintenance` (CRON_SECRET; `vercel.json` daily) retries and expires stale checkouts. Without a provider: recorded `not_configured`, never claimed as sent.
- **Legal**: `npm run content:legal` adds DRAFT templates (terms, privacy incl. voice-chat P2P/IP disclosure, returns with 14-day withdrawal + model form, shipping, cookies, legal-notice) — never overwrites. **Production checkout refuses orders until terms/privacy/returns are published.** No cookie banner: only strictly necessary storage today (add consent before any analytics/ads).
- **Help** `/contact` (nav "Help"): order lookup (email + order number → signed order page), contact form (→ admin notification always + email to SUPPORT_EMAIL with reply-to; honeypot + rate limit), FAQ.
- **SEO**: `robots.ts` (indexing only on production; blocks admin/api/checkout/order/dev), `sitemap.ts` (no mock products), product JSON-LD (price/stock) + canonical, OpenGraph defaults. Mock products are `noindex`.
- **3D voice**: per-shopper local Mute in the room panel (gain node).
- Verified in the browser (local DB + simulator): cart → checkout quote → pay → order #100001 paid → order page → cart cleared; lookup + contact form; robots/sitemap; mute. Tests: unit 85/85 · integration 26/26 (new `checkout.test.ts`: preview = order total, idempotent resubmit, webhook → paid, expiry releases stock, email queued + sent once, signed links) · e2e 12/12 (updated for live checkout link + rotate prompt; caught and fixed the room badge covering the touch Pause button) · typecheck/lint clean · build OK.
- Local dev DB now has a TEST shipping zone (Italy) + TEST IT VAT 22 % and test order #100001 — replace with real settings in Admin.
- **Owner to do before launch**: Stripe test keys → test → live (`STRIPE_ALLOW_LIVE=true`); Resend account + verified domain; set `ORDER_LINK_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`, `SUPPORT_EMAIL` in Vercel; fill + lawyer-review + publish legal pages; real shipping zones/rates and accountant-confirmed tax rates; real products.
- 2026-11-22: Stripe webhook endpoint is `https://www.wegoshiiip.com/api/webhooks/stripe` (apex domain does not resolve; Stripe does not follow redirects). Verified live: unsigned POST → 400 "Invalid signature". Admin payments page now shows this URL in every env; live keys without `STRIPE_ALLOW_LIVE=true` now show "not configured" instead of crashing the webhook with a 500.
- **Not done yet**: customer accounts/login, server-side cart, analytics, error monitoring (Sentry), supplier API integrations, abuse reporting in voice rooms, Stripe webhook tested against real Stripe test mode.

## Multiplayer rooms + voice chat in the 3D store (2026-11-21)
`src/features/store3d/multiplayer/` — shoppers are auto-matched into rooms of up to 10 (`rooms.ts`, first come first served; the 11th moves to the next room, ties broken by id so every client agrees). Everyone in a room sees the others as avatars (colored body, name tag, green ring while speaking, mic badge) and can talk.
- **Transport**: Supabase Realtime public channels `mm-store-room-<n>` (presence = members, broadcast = WebRTC signaling) with the publishable key; no tables/secrets. Voice + positions over a P2P WebRTC mesh (audio transceiver + unreliable data channel at 10 Hz; Realtime broadcast ≤2.5 Hz fallback while a data channel isn't open).
- **Voice**: mic off by default; V key or the mic button (top-left) toggles it (echo cancel/noise suppression). Spatial audio (HRTF panner per peer; closer = louder). Audio unlocked on "Click to enter". Join toasts; editable display name (random "Happy Panda" style, saved locally).
- **Dev without Supabase keys** (this machine): `local-channel.ts` = same-browser test room over BroadcastChannel, labelled "Local test room"; never used in production (prod without keys → "Solo shopping").
- Verified: typecheck, lint, unit 85/85 (+`store-rooms.test.ts`), build. Two local tabs joined the same room, WebRTC connected, data channels open, poses delivered. **Not verified**: avatars on screen (browser pane was hidden), real voice between two devices, Supabase Realtime path (no keys here).
- **Limits**: STUN only; ~10–20% of users behind strict NAT/mobile carriers need TURN → set `NEXT_PUBLIC_TURN_URL/USERNAME/CREDENTIAL` (e.g. a managed TURN service). Channels are public: anyone with the publishable key can join a room (names are sanitized; no moderation/report/kick yet). Needs HTTPS for the mic.

## iPhone / iOS compatibility pass (2026-11-21)
Reported: 3D store doesn't work for iPhone users (works on Android). No iOS device on this machine, so the fixes target the usual WebKit failure modes:
- `input/device.ts` `isIOS()` (incl. iPadOS-as-Mac). iOS always uses the low-power budget, DPR cap 1.25 (Android 1.5, desktop 1.75).
- Product shelf-label photos are downscaled on a canvas before GPU upload (256 px mobile / 512 px desktop). Before, every uploaded photo (up to 2400 px ≈ 20 MB GPU each) went to the GPU at full size, which can crash an iOS tab.
- WebGL context loss (iOS memory pressure/backgrounding) → play pauses + "3D view was paused" notice with Reload/Catalog (`ui-store.contextLost`); clears on restore. The WebGL2 probe context in `StoreClient` is released right after the check.
- Audio: `webkitAudioContext` fallback + resume in `sfx.ts`; music goes through a Web Audio gain node when `audio.volume` is read-only (iOS), so fades/ducking work.
- Verified: typecheck, lint, unit 82/82, build; mobile emulation (375×812) loads, and a simulated context loss shows and clears the notice. Prod bundle has no Safari-16.4-incompatible APIs (Next's baseline; iOS < 16.4 is unsupported by Next 16). **Still needs a test on a real iPhone.**

## Product image management (2026-11-22)
- **Admin**: image section on every product (Add/Edit) + **Image Manager** (`/admin/products/images`: search, category, missing/multiple filters, main-image previews, quick upload/replace/delete, bulk upload by file name = slug or SKU (`-2` suffix = gallery) with match preview, bulk “remove all images”, storage cleanup). Drag-and-drop/browse upload with previews, dimensions, size, client-side compression, per-file progress (XHR), toasts; gallery drag-and-drop reorder (+ arrow buttons) → Save order, set main, replace, delete, alt text, full-size preview.
- **Storage**: Supabase bucket `products` (`{product-id}/{uuid}.webp`, server-side secret key only) via `src/lib/media/storage.ts`; dev fallback = local disk + `/api/media` (labelled in the UI; disabled in production). sharp validation + WebP normalization (`src/lib/media/process.ts`). Upload routes `/api/admin/products/[id]/images`, `/api/admin/images/bulk` (permission + same-origin checked).
- **Safety**: upload first, DB second (new object removed if the DB step fails, old images intact); replace = new key, old object deleted after commit; objects deleted only when no product row references them; orphan cleanup with 1 h grace. Order items never stored image references, so order history is unaffected.
- **Storefront sync** (same `product_images` rows → `Product.imageUrl` + `gallery`): catalog cards, new product page `/catalog/[slug]` with gallery, cart line thumbnails (`PricedLine.imageUrl`), 3D store product panel/peek **and** shelf placeholders (main image as front label). Every change revalidates /, /catalog, /catalog/[slug], /store.
- Migration `20261122000001_product_image_management.sql` (product_images: bucket, is_primary (one per product), width/height/bytes/mime, created_by; bucket `products`). Applied locally; **not pushed to Supabase**.
- Verified in the browser on the dev server (olive oil: 3 uploads incl. a 3000×2000 compressed to 2400×1600, set main, drag-reorder, preview, delete → catalog card, product page, cart thumbnail and 3D shelf labels updated; bulk upload matched 2 of 3 files). Supabase Storage path NOT yet tested against the real project (no keys on this machine).
- Tests: unit 82/82 · integration 21/21 · SQL tests pass · e2e 12/12 (incl. image acceptance flow + upload permissions) · e2e 12/12 (updated for live checkout link + rotate prompt; caught and fixed the room badge covering the touch Pause button) · typecheck/lint clean · build OK.

## Super Admin dashboard (2026-11-21) — `/admin`
Real, DB-driven admin on the SAME tables the catalog/3D store read. Design: ARCHITECTURE.md "Admin dashboard"; setup: INTEGRATION_GUIDE.md "Admin dashboard" / "Local database".
- **Migration** `20261121000001_admin_foundation.sql` (additive): admin_users/sessions/activity_log (append-only), product extras (brand, tags, SEO, featured, soft delete), product_shelf_placements, inventory incoming/supplier-reported/threshold + inventory_movements (append-only) + inventory_reservations + functions admin_adjust_inventory / reserve_order_inventory / settle_order_inventory, supplier_order_items, order_notes, refunds, invoices (+seq, immutable), shipping zones/methods/rates, exchange_rates, expenses, discount targeting, reviews, store_settings, cms_pages, admin notifications (+reads), email_outbox, orders.is_test/base_currency/fx_rate_to_base. **Not yet pushed to the live Supabase DB** — run `db push` (the storefront's Supabase REST path now selects its new columns).
- **Modules** (all permission-checked server-side): Overview KPIs/charts (date presets + custom), Products (filters, bulk publish/unpublish/archive/category/delete, CSV import with dry run + export, variants/prices EUR+USD/compare-at/weight/barcode, supplier cost + margin, https image URLs, 3D shelf pin/priority/hide, soft delete when ordered), Categories (nested, reorder, activate), Inventory (adjust with reason, incoming, supplier-reported, movement log, low-stock alerts), Orders (filters, timeline, notes, state-machine transitions, supplier split, manual supplier refs, shipments with real tracking, refunds via provider or recorded manual, invoices, CSV), Customers (masked unless customers.pii), Suppliers (+mapping, supplier orders), Shipping (fixed/weight/order-value tiers, free threshold), Payments (provider status, transactions, refunds, webhook log, FX rates), Discounts (dates, limits, per-customer, currency, category/product targets), Analytics (profit estimated vs final, expenses, CSV reports), Reviews moderation, Store (3D) live shelf plan, Website Content (homepage hero/announcement + CMS pages draft/publish), Notifications (read/unread), Settings (store, seller/invoice details, tax rates, base currency, stock-all-aisles, own password), Admin Users (roles + per-permission overrides), Activity Log (before/after), global search.
- **Auth**: separate admin accounts (scrypt, hashed httpOnly session tokens, 12 h, lockout 5×/15 min). Roles SUPER_ADMIN/ADMIN/PRODUCT_MANAGER/ORDER_MANAGER/SUPPORT. First admin: `npm run admin:create`.
- **Storefront integration**: catalog + 3D store read `DATABASE_URL` when set (falls back to Supabase REST, then mock; dev-only fallback to mock if the local DB is down); admin changes revalidate /, /catalog, /store. Homepage hero/announcement + `/pages/[slug]` from CMS; footer lists published pages. `/api/cart/price` accepts an optional `couponCode` (server-validated). `/api/webhooks/[provider]` (Stripe / dev simulator) — transactional dedupe.
- **Local dev DB**: `npm run db:local` (embedded PostgreSQL 18). `.env.local` now has `DATABASE_URL` for it + a local test super admin (credentials in `.env.local` `DEV_ADMIN_*`). Admins are not part of `seed.sql`: if the dev data dir is recreated, re-run `npm run admin:create` with those values, or login fails with "Email or password is incorrect". 3 TEST orders seeded (`npm run db:seed-test-orders`); one test product "Admin Test Biscuits" was created through the UI — delete it in Admin → Products if unwanted.
- **Honest limits**: no checkout route yet (createOrder service exists + tested; Phase 5 wires Stripe Checkout). Refunds/payments need Stripe test keys. No supplier API adapters (manual mode only). No email provider (emails logged as not_configured). Image upload to Supabase Storage not wired (image URL field). No live FX feed (manual rates). Review submission UI (storefront) not built. Tax rates/seller details/shipping zones must be filled by the owner.
- **Tests**: unit 78/78 · integration 16/16 (orders + overselling race, webhook idempotency, supplier split, admin auth/RBAC/lockout, products→catalog→3D layout, CSV all-or-nothing) · SQL RLS tests pass · e2e 10/10 · typecheck + lint clean · `next build` OK.

## Current phase
Phase 1 cleanup (Claude Code, 2026-11-20): app installs, builds and runs locally; e2e smoke tests added. Remaining in Phase 1: manual walk/buy test, benchmark aisle approval → stock all faces. Supabase schema live and verified.

### Phase 1 cleanup done (2026-11-20)
- `git init` (nothing committed yet). `.gitignore` now excludes `CCHA.md` (chat log), `supabase/.temp/`, `3D models/` (90 MB originals), `skills_install/`.
- Secrets redacted from `CCHA.md` (Supabase secret key, DB password) — still must be **rotated**.
- `next.config.ts`: `turbopack.root` pinned (stray lockfile in user home). `postcss.config.mjs` lint warning fixed.
- Project skills installed to `.claude/skills/` (3d-web-game, glb-asset-optimization, token-efficient-engineering).
- `src/app/icon.svg` favicon (was a 404 on every page).
- Playwright: `playwright.config.ts` (prod build, local Edge via `channel: "msedge"`, no browser download) + `tests/e2e/smoke.spec.ts` — home, catalog add-to-cart → server pricing (client sends ids+qty only), API validation/unknown variant, /store loads both GLBs. **5/5 pass**.
- Store: pointer-lock refusal now shows a message on the entry overlay (`lockError` in `ui-store.ts`) instead of failing silently.
- `.claude/launch.json` (dev server preview).
- Touch controls (`features/store3d/input/*`, `actions.ts`) were being added concurrently by another session — not part of this cleanup.

### Marketplace catalog (2026-11-20)
- `/catalog` redesigned as a marketplace storefront: search bar with category selector, desktop filter sidebar + mobile slide-in drawer (category, price in market currency, in-stock, product options), active-filter chips + clear all, sort (relevance, price ↑/↓, name A–Z/Z–A; no "newest" — products have no created date), result count, empty state.
- All state in URL params (`q, category, min, max, stock=in, opt=key:value, sort, market`); filtering/sort/facets server-side in `lib/catalog/query.ts` (pure, `tests/unit/catalog-query.test.ts`). Price bounds parsed to integer minor units in the URL's `market`; `MarketParamSync` re-runs the query when the shopper's region differs (drops typed bounds).
- Variants without structured attributes appear as "Option" facets by variant name.
- `ProductCard`: square image/labelled "No photo yet" placeholder, "Sample product" badge for mocks, category, price + VAT/tax note, stock, option count, option select, full-width Add to cart. No ratings/reviews/sales/discounts.
- Components: `components/catalog/CatalogFilters.tsx` (server), `CatalogControls.tsx` (client). Verified in browser desktop + 375px; catalog e2e passes (against dev server). Full `typecheck`/`build` blocked at the time by in-progress `admin/(panel)/products/page.tsx` (other session).

### Visual refresh (2026-11-20)
- Type: Bricolage Grotesque (display, 700 / -0.03em by default via `.font-display`), Plus Jakarta Sans (body), JetBrains Mono (`.eyebrow` labels, prices meta, keycaps). Fonts wired in `app/layout.tsx`, tokens in `globals.css` (`--color-line`, `--shadow-card/lift`, `.vsw-card`, `.vsw-grid-bg`, `.vsw-marquee`).
- Redesigned home (bigger hero + stats, category ribbon of real categories only, numbered feature cards, keycap steps, CTA band), site header/footer (logo mark, big wordmark footer), catalog header/chips, `ProductCard`, `CartButton`, `MarketSwitch`. 3D HUD inherits the new fonts automatically.
- 3D store loading screen (brand mark, eyebrow, big % readout, numbered tips) and `CartDrawer` (slide-in, item count, initial tiles, pill stepper, display subtotal; e2e-relied labels kept) restyled to match.
- Verified in browser at desktop + 375px (no overflow, no console errors). e2e not re-run.
- `<html suppressHydrationWarning>`: browser extensions (wallets) inject attributes on `<html>`.

### Mobile gameplay (2026-11-20)
Phones/tablets now play the 3D store (the old "made for desktop" block in `StoreClient` is gone; only missing WebGL2 falls back).
- **Input layer**: `input/touch-input.ts` (shared mutable analog state, joystick math, speed curve, look sensitivity), `input/device.ts` (touch detection). `ui-store`: `touchMode` + mode-agnostic `requestLock`/`releaseLock` (pointer lock on desktop, plain "playing" flag on touch). Hybrid devices switch to touch on the first touch, and back on a mouse click while paused.
- **Same gameplay systems**: `Player` reads keyboard first, else the analog joystick (speed ∝ push, run past 85%). `input/TouchLook` rotates the same camera as PointerLockControls (YXZ, ±85° pitch, light smoothing). `actions.ts` (`interactWithTarget`, `openCartFromStore`) is used by both the E/C keys and the touch buttons.
- **`hud/TouchControls.tsx`**: floating joystick (bottom-left zone, springs back), drag-to-look anywhere else (multitouch via pointer ids + capture), buttons: Interact (lights up when a product is in range), Cart (with count badge), Level camera, Pause. Safe-area insets, no browser scroll/zoom (`touch-action: none`, store viewport `userScalable: false`, iOS `gesturestart` blocked). Haptic tick on Android.
- Touch aim assist in `Interactor` (small ray cone when the center ray misses). Closing the cart resumes play on touch. Pauses when the app is backgrounded. Fullscreen on enter where supported (not iPhone).
- **Responsive**: pause menu (touch help + look sensitivity Low/Med/High, persisted), product panel and cart drawer for portrait/landscape (`short:` variant = max-height 520px in `globals.css`), loading tips per device.
- **Perf (coarse-pointer devices only)**: DPR cap 1.5, dropping to 1 via `PerformanceMonitor` on low FPS; shadow map 1024 (desktop 2048), env map 128. Desktop is unchanged.
- **Verified in the built-in browser** (mobile emulation 375×812, 320×568, 844×390 landscape): joystick + simultaneous look drag, walk to a product → prompt + Interact → product panel → option/qty → Put in trolley (animation, badge, toast) → Cart (server-priced) → close → back in play; orientation change mid-game; desktop WASD/C regression. Synthetic touch events only — **still needs a test on a real phone** (feel, sensitivity, iOS Safari).
- Dev-only debug handle `window.__vsw` (camera, ui store, interaction registry) in `StoreExperience` for browser automation; stripped in production.
- Fix: touch buttons act on pointerdown, so the browser's follow-up "ghost click" landed on the newly opened cart's backdrop and closed it; `swallowGhostClick()` in `TouchControls.tsx` eats that one click.

### Look-to-preview product card (2026-11-20)
Looking at a product (same crosshair raycast + range as E) opens an AR-style callout after a 170 ms dwell: a pulsing pin on the exact point you look at, a leader line drawing to a glass card that flips in in 3D (perspective, depth layers: photo pops forward, text rises in stagger, light sweep, idle float, tilt that lags behind camera turns). Card shows category, name, price ("from" when options differ; VAT/tax note per market), stock, options, description, "Sample product" / "Photo coming soon" labels, and the E / Tap ✋ hint. Look away → it folds out.
- `peek/PeekTracker.tsx` (in Canvas: pins the hit point per product, projects it to screen, camera turn rate) → `hud/ProductPeek.tsx` (DOM card, direct style writes per frame, no React re-render) + `hud/product-peek.css`.
- Layouts: desktop right of the crosshair; phone portrait compact card at the top; phone landscape compact card top-right above the touch buttons. The old "E Inspect …" pill now shows only for the checkout target.
- Display only (catalog data, like the product panel); cart pricing stays server-side.
- Verified in the built-in browser: desktop 1024×768, phone 375×812 and 844×390 (open, tilt, close on look-away, E → product panel). Real product photos not tested yet (all products are mock with no `imageUrl`).

## Decisions
- First-person camera (no player avatar; character GLB not needed).
- Markets: Italy-based; EU-27 in EUR (VAT-inclusive), USA in USD (tax-exclusive).
- Payments: Stripe (test mode until business verified).
- Backend: Supabase project `xnmgiluewsjbaqlhlfim` (keys in `.env.local`, gitignored).

## Completed — implemented and tested
- `src/lib/money.ts`, `markets.ts`, `orders/state-machine.ts`, `cart/pricing.ts` (EUR inclusive / USD exclusive tax).
- `src/lib/suppliers/*` — adapter contract, retry/timeout, idempotent submission, manual fallback.
- `src/lib/payments/*` — provider contract, Stripe provider (REST), dev simulator, webhook handler.
- Unit: 39/39 pass (`npm run test:unit`); `tsc` strict clean.
- `supabase/migrations/*` + `seed.sql`: applied to local Postgres 16 with Supabase role stubs; `supabase/tests/rls_and_constraints.sql` passes (RLS isolation, admin-only writes, immutable orders, transition guard, oversell & duplicate-webhook protection).

- Supabase: migrations + seed pushed to project `xnmgiluewsjbaqlhlfim`; `rls_and_constraints.sql` passed on the live DB (owner, 2026-11-20).
- Store layout generator (`features/store3d/layout.ts`) and Supabase row mapping (`lib/catalog/source-map.ts`): unit tested.

## Implemented but not yet run (needs `npm install` + browser)
- Next.js app: landing `/`, catalog `/catalog` (category filter), 3D store `/store`, cart drawer, `/api/cart/price`.
- 3D: first-person pointer-lock player (Rapier capsule), room/shelves/signs/checkout, instanced placeholder products, crosshair raycast interaction (E), product panel, loading screen, WebGL fallback, error boundary; touch controls (see "Mobile gameplay").
- **Imported 3D assets** (see ASSET_INVENTORY.md): supermarket environment (optimized from `super_market_for_free.glb`, sample products stripped, 19 draw calls) with physics from a measured layout; real Sketchfab trolley (`cart_basket.glb`, converted to metal-rough). Asset registry: `features/store3d/assets/registry.ts`.
- **Benchmark aisle** (faces L1N/L2S) stocked with catalog products on the real shelf boards, live price tags (EUR/USD), aisle signs, checkout zone on the imported counter. **Browser-verified 2026-11-20** (built-in browser, /store?cam=…): store renders, products on boards, price tags, aisle signs, GLB trolley in view, basket shows cart units, /api/cart/price correct.
- **Trolley**: pushed in first person; yaw follows the view with lag, own collider, rattle. "Put in trolley" launches a shelf → basket animation (lift, arc + spin, drop, squash-settle, trolley jiggle, synthesized drop sound); basket shows one item per cart unit (max 36), persisted via cart.
- Catalog reads Supabase (publishable key, public RLS) when `.env.local` is set, else mock data.
- **Branding & ambience** (2026-11-20): site renamed "Mega Market" / "Happy Family, Happy Animals"; hero photo (`src/assets/hero/`); branded animated loading screen (`src/assets/loading/`); store background music (`public/audio/store-music.mp3`, `features/store3d/music.ts`): starts on the Enter click, ducks in menus, M key / top-right toggle mutes (remembered). Song licence for commercial use not yet confirmed by owner.
- Stripe provider: tested with signed fixtures and a fake fetch, not yet against Stripe test mode (deferred by owner).

## Mocked
- Catalog seed (10 generic items, `is_mock`), mock supplier, dev payment simulator.

## Remaining (by phase)
1. **3D**: first run + fix; e2e smoke test (Playwright); measure FPS/draw calls; real GLBs when available.
2. **Commerce**: auth pages (Supabase Auth via @supabase/ssr), server-persisted guest/auth cart, accounts, addresses, orders.
3. **Admin**: dashboard, products/variants/prices/GLB upload, store layout editor, suppliers, inventory, tax rates, orders, customers, analytics.
4. **Dropshipping**: Supabase FulfillmentStore, sync jobs, reconciliation.
5. **Checkout**: `/api/checkout` (create order + Stripe session), `/api/webhooks/stripe`, confirmation, emails.
6. **Production**: security/perf review, e2e, deployment.

## Known bugs / limitations
- **No `.env.local` on the owner's machine → app serves the MOCK catalog, not Supabase.** Create it (see INTEGRATION_GUIDE.md).
- Floor material of the imported store looks glossy/busy; tune roughness if the owner wants.
- Not browser-tested yet: walking/collision with pointer lock, E-interaction, shelf → trolley flight (needs a human mouse; test manually). The Claude desktop browser pane refuses pointer lock, so this must be tested in a normal browser.
- `/store` is statically prerendered (revalidate 60 s): the catalog baked at build time is mock until `.env.local` exists at build.
- Dev server takes ~15–20 s to compile /store on first load; `npm run build && npm start` for real timings.
- Only the benchmark aisle is stocked (`STORE_CONFIG.stockAllFaces`); end caps, wall racks and freezers are empty.
- Sketchfab licenses/attribution not yet recorded (ASSET_INVENTORY.md).

## Test status
- 2026-11-21: unit 78/78 · integration 16/16 (`npm run test:integration`) · `npm run test:db` pass · E2E 10/10 (`npm run test:e2e`: fresh DB → `next build` → Playwright; incl. 4 admin tests) · typecheck, lint clean.
- Earlier: Unit 60/60 (incl. `touch-input.test.ts`) · DB tests pass (local + live) · E2E 5/6 (`npm run test:e2e`; both 3D store tests incl. phone/touch pass; the home-page test fails because the redesigned landing page has two "Enter the store" links inside `<main>` → strict-mode violation; use `.first()` or a more specific locator) · typecheck, lint clean · `next build` OK.

## Needed from owner
- **Rotate the Supabase secret key** (it was shared in chat) and update `.env.local`.
- Stripe test keys: `sk_test_…`, `pk_test_…`, webhook `whsec_…`.
- Change the Supabase DB password (it was shared in chat).
- Accountant-confirmed tax rates (Italy/EU OSS, US states with nexus).
- Real products, photos, GLBs; supplier(s) + API docs + credentials; domain; email provider.

## Exact next action
0. Owner: push the admin + image migrations to Supabase (`npx supabase db push`), add `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SECRET_KEY` (images), set `DATABASE_URL` (transaction pooler) in `.env.local`/Vercel, create your super admin (`npm run admin:create`), then fill Settings (seller, tax rates), Shipping and an exchange rate.
1. Owner: rotate Supabase secret key + DB password; create `.env.local` from `.env.example`; walk the benchmark aisle at http://localhost:3000/store in Edge/Chrome (WASD, E on a product, Put in trolley) and approve or list fixes.
   Phone test: `npm run build && npm start`, then open `http://<PC LAN IP>:3000/store` on the phone (same Wi-Fi) — check joystick feel, look sensitivity, Interact range, iOS Safari.
2. Then: `STORE_CONFIG.stockAllFaces = true` (+ end-cap/wall-rack/freezer faces in `build_env.py`), re-run `npm run test:e2e`.
3. Phase 2: Supabase Auth (@supabase/ssr) pages, server-persisted guest/auth cart, account/addresses/orders.

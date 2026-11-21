# Project Status

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
- Tests: unit 82/82 · integration 21/21 · SQL tests pass · e2e 12/12 (incl. image acceptance flow + upload permissions) · typecheck/lint clean · build OK.

## Super Admin dashboard (2026-11-21) — `/admin`
Real, DB-driven admin on the SAME tables the catalog/3D store read. Design: ARCHITECTURE.md "Admin dashboard"; setup: INTEGRATION_GUIDE.md "Admin dashboard" / "Local database".
- **Migration** `20261121000001_admin_foundation.sql` (additive): admin_users/sessions/activity_log (append-only), product extras (brand, tags, SEO, featured, soft delete), product_shelf_placements, inventory incoming/supplier-reported/threshold + inventory_movements (append-only) + inventory_reservations + functions admin_adjust_inventory / reserve_order_inventory / settle_order_inventory, supplier_order_items, order_notes, refunds, invoices (+seq, immutable), shipping zones/methods/rates, exchange_rates, expenses, discount targeting, reviews, store_settings, cms_pages, admin notifications (+reads), email_outbox, orders.is_test/base_currency/fx_rate_to_base. **Not yet pushed to the live Supabase DB** — run `db push` (the storefront's Supabase REST path now selects its new columns).
- **Modules** (all permission-checked server-side): Overview KPIs/charts (date presets + custom), Products (filters, bulk publish/unpublish/archive/category/delete, CSV import with dry run + export, variants/prices EUR+USD/compare-at/weight/barcode, supplier cost + margin, https image URLs, 3D shelf pin/priority/hide, soft delete when ordered), Categories (nested, reorder, activate), Inventory (adjust with reason, incoming, supplier-reported, movement log, low-stock alerts), Orders (filters, timeline, notes, state-machine transitions, supplier split, manual supplier refs, shipments with real tracking, refunds via provider or recorded manual, invoices, CSV), Customers (masked unless customers.pii), Suppliers (+mapping, supplier orders), Shipping (fixed/weight/order-value tiers, free threshold), Payments (provider status, transactions, refunds, webhook log, FX rates), Discounts (dates, limits, per-customer, currency, category/product targets), Analytics (profit estimated vs final, expenses, CSV reports), Reviews moderation, Store (3D) live shelf plan, Website Content (homepage hero/announcement + CMS pages draft/publish), Notifications (read/unread), Settings (store, seller/invoice details, tax rates, base currency, stock-all-aisles, own password), Admin Users (roles + per-permission overrides), Activity Log (before/after), global search.
- **Auth**: separate admin accounts (scrypt, hashed httpOnly session tokens, 12 h, lockout 5×/15 min). Roles SUPER_ADMIN/ADMIN/PRODUCT_MANAGER/ORDER_MANAGER/SUPPORT. First admin: `npm run admin:create`.
- **Storefront integration**: catalog + 3D store read `DATABASE_URL` when set (falls back to Supabase REST, then mock; dev-only fallback to mock if the local DB is down); admin changes revalidate /, /catalog, /store. Homepage hero/announcement + `/pages/[slug]` from CMS; footer lists published pages. `/api/cart/price` accepts an optional `couponCode` (server-validated). `/api/webhooks/[provider]` (Stripe / dev simulator) — transactional dedupe.
- **Local dev DB**: `npm run db:local` (embedded PostgreSQL 18). `.env.local` now has `DATABASE_URL` for it + a local test super admin (credentials in `.env.local` comments). 3 TEST orders seeded (`npm run db:seed-test-orders`); one test product "Admin Test Biscuits" was created through the UI — delete it in Admin → Products if unwanted.
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

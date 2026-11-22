# Integration Guide

## Local development
```
npm install                 # first time: see PROJECT_STATUS.md "Exact next action"
npm run dev                 # http://localhost:3000
npm run test:unit
```
`.env.local` holds keys (gitignored). Only `NEXT_PUBLIC_*` reach the browser; the Supabase secret key and Stripe secret key are server-only.

## Supabase (project `xnmgiluewsjbaqlhlfim`)
1. Rotate the secret key (Settings → API Keys) because it was shared in chat; update `SUPABASE_SECRET_KEY`.
2. Apply schema: `npx supabase link --project-ref xnmgiluewsjbaqlhlfim` then `npx supabase db push --include-seed` (asks for the DB password).
   Without the CLI: paste `supabase/migrations/*.sql` in order, then `supabase/seed.sql`, into the SQL editor.
3. Verify: run `supabase/tests/rls_and_constraints.sql` in the SQL editor → `ALL DB TESTS PASSED` (it rolls back).
4. Apply the admin migration `supabase/migrations/20261121000001_admin_foundation.sql` too (`db push` does it). The storefront's Supabase REST reads use its new columns (`categories.is_active`, `products.deleted_at`, `product_shelf_placements`).
5. Auth → URL configuration: add `http://localhost:3000` and the production domain.

## Admin dashboard (`/admin`)
- Needs `DATABASE_URL` (server only): Supabase → Project Settings → Database → Connection string → **Transaction pooler** (port 6543). The admin talks to Postgres directly (real transactions/row locks); admin tables have RLS with no policies, so browser keys can never read them.
- Create the first super admin (no public sign-up): `$env:ADMIN_PASSWORD="…"; npm run admin:create -- --email you@company.com --name "Your Name" --role SUPER_ADMIN` (PowerShell). Further admins are added in Admin → Admin Users.
- Admin accounts are separate from customer accounts (own table, scrypt hashes, httpOnly session cookie, 12 h sessions, lockout after 5 failed logins). Roles: SUPER_ADMIN, ADMIN, PRODUCT_MANAGER, ORDER_MANAGER, SUPPORT + per-user permission overrides (`src/lib/admin/permissions.ts`).
- Fill in before selling: Settings → seller details + tax rates (accountant-confirmed); Shipping → zones/methods; Payments → exchange rate (for EUR/USD reporting).

## Product images (Admin → Products → Image Manager)
- Stored in Supabase Storage bucket **`products`** as `{product-id}/{uuid}.webp`; `product_images` keeps only path + metadata (main flag, order, size, dimensions). Created by migration `20261122000001_product_image_management.sql` (public read; no client write policies — the server writes with `SUPABASE_SECRET_KEY` after the admin's `products.edit` check).
- Needs `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SECRET_KEY` in `.env.local` / Vercel. Then verify once: upload an image in the admin and open it in the catalog (the Supabase path has not been exercised against your project yet).
- Uploads: JPEG/PNG/WebP/AVIF, validated from the bytes with sharp, EXIF-rotated, downsized to max 2400 px, re-encoded to WebP (metadata stripped). Oversized files are also compressed in the browser before upload.
- Without Supabase keys, development saves images on this computer (`%LOCALAPPDATA%megamarket-media`, served by `/api/media`); those are NOT migrated automatically to Supabase. Production refuses uploads until Storage is configured.

## Local database (development / tests)
- `npm run db:migrate` applies new migrations to the local DB (refuses non-local URLs).
- `npm run db:local` runs a real PostgreSQL 18 (npm `embedded-postgres`, data in `%LOCALAPPDATA%megamarket-dbdev`) with Supabase stubs + all migrations + seed. Put the printed `DATABASE_URL` in `.env.local`. `-- --fresh` resets it.
- `npm run db:seed-test-orders` creates 3 TEST orders (badged “TEST”, excluded from KPIs) in the local DB only.
- `npm run test:db` (SQL RLS/constraint tests), `npm run test:integration` (services against a fresh Postgres per file), `npm run test:e2e` (fresh DB → build → Playwright).

## Stripe (test mode first)
1. Dashboard → Developers → API keys: copy `sk_test_…` / `pk_test_…` into `.env.local`.
2. Local webhooks: `stripe listen --forward-to localhost:3000/api/webhooks/stripe` → copy the `whsec_…` into `STRIPE_WEBHOOK_SECRET`.
3. Production webhook endpoint `https://<domain>/api/webhooks/stripe`, events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` (cancels the unpaid order and frees its stock), `payment_intent.payment_failed` (declined attempts, shown on the admin order; the order stays open for a retry), `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed` (per-refund status for partial refunds and failures). The webhook re-checks every payment with the Stripe API (PaymentIntent + balance transaction for actual fees), so the secret key must be able to read PaymentIntents.
4. Enable the payment methods you want for EU/US in the Stripe Dashboard (Checkout shows what's enabled).
5. Live keys are refused by the code until the account is activated and `allowLive` is set deliberately.

## Taxes
EU prices are VAT-inclusive, US prices tax-exclusive. Rates live in `tax_rates` (Admin → Settings): one row per country, optionally per region (US state, e.g. `US` + `NY`). Lookup: exact country+region first, else the country-wide row; no row → checkout refuses that destination (nothing is guessed). Every order stores the applied rate (`tax_rate_bps`), country/region and amounts.
**Not handled (needs an accountant / tax provider):** product-specific tax classes (reduced VAT on food/books, US exemptions), US local (county/city) rates, OSS thresholds, US nexus decisions. The rates in the local dev DB are TEST values. For automatic rates later, plug Stripe Tax (or similar) in behind `priceOrder` → `taxRateFor`.

## Shipping
Admin → Shipping prices: zones (countries) → methods (fixed / weight tiers / order-value tiers, free-over threshold, optional min–max business days). Checkout shows only methods for the destination, with the price before payment; delivery days are shown as an ESTIMATE and stored on the order (`shipping_min_days/max_days`). US addresses need a state + ZIP; billing address optional (defaults to delivery address).

## Suppliers (not configured)
Implement `SupplierAdapter` per supplier from its official API docs; declare only supported capabilities. Store the API secret in Supabase Vault and its name in `supplier_credentials`.

## Production readiness checklist
Run `npm run check:env` in the production environment (prints variable NAMES with problems, never values; exit 1 = not ready).
- **Env (Vercel → Production):** `NEXT_PUBLIC_SITE_URL` (https), `DATABASE_URL` (Supabase pooled, not localhost), `ORDER_LINK_SECRET` (32+ random), `CRON_SECRET` (16+), `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (+ `STRIPE_ALLOW_LIVE=true` only after the test-mode run), `RESEND_API_KEY` + `EMAIL_FROM` (verified domain), `SUPPORT_EMAIL`, Supabase URL/keys. Never set `PAYMENT_PROVIDER=dev-simulator` there. SEO (optional): `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BING_SITE_VERIFICATION`, `NEXT_PUBLIC_SOCIAL_URLS` (comma-separated https profile URLs) — see SEO_STRATEGY.md §8. Use separate Stripe/Supabase projects (or at least test keys) for Preview deployments.
- **Migrations:** apply `supabase/migrations/*` in order (`supabase db push`); all Phase 1/2 migrations are additive. Take a backup first.
- **Backups:** enable Supabase daily backups (Pro) and Point-in-Time Recovery for a live shop; test one restore into a separate project.
- **Stripe:** webhook endpoint + events listed above; one test-mode order, partial refund and full refund end-to-end before going live.
- **HTTPS / headers:** Vercel serves HTTPS; `next.config.ts` adds HSTS (production), nosniff, frame and referrer policies (`no-referrer` on `/order` and `/account`, whose URLs carry signed tokens).
- **Rate limiting:** built-in limits are per server instance (in memory). Add Vercel Firewall / WAF rules for real abuse protection.
- **Logging:** server errors go through `lib/log.ts` (no query parameters, emails masked). **Monitoring/error reporting is not installed** — recommended: Sentry (or Vercel Observability) + an uptime check on `/` and alerts on failed cron runs.
- **Cron:** `vercel.json` runs `/api/cron/maintenance` daily (expire unpaid checkouts, retry emails, fill Stripe fees).

## Deployment
Vercel for Next.js (set the same env vars), Supabase hosted. GLBs/images in Storage buckets `product-models` / `product-images` (public read, admin write) served via CDN.

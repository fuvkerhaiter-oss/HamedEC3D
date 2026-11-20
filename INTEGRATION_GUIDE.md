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
3. Production webhook endpoint `https://<domain>/api/webhooks/stripe`, events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`.
4. Enable the payment methods you want for EU/US in the Stripe Dashboard (Checkout shows what's enabled).
5. Live keys are refused by the code until the account is activated and `allowLive` is set deliberately.

## Taxes
EU prices are VAT-inclusive, US prices tax-exclusive. Fill `tax_rates` (admin) with rates confirmed by your accountant (EU OSS registration, US states where you have nexus). Alternative later: Stripe Tax.

## Suppliers (not configured)
Implement `SupplierAdapter` per supplier from its official API docs; declare only supported capabilities. Store the API secret in Supabase Vault and its name in `supplier_credentials`.

## Deployment
Vercel for Next.js (set the same env vars), Supabase hosted. GLBs/images in Storage buckets `product-models` / `product-images` (public read, admin write) served via CDN.

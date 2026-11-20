# Architecture — Mega Market

## Stack
| Layer | Choice | Purpose |
|---|---|---|
| App | Next.js (App Router), React, TypeScript strict, Tailwind | Pages, API routes, SSR |
| 3D | three, @react-three/fiber, @react-three/drei, @react-three/rapier | Store scene, controller, physics |
| Client state | zustand | UI + cart mirror (server is source of truth) |
| Validation | zod | All API input |
| Backend | Supabase (Postgres, Auth, Storage, RLS) via @supabase/ssr | Data, auth, GLB/image storage |
| Tests | node:test via tsx (unit), Playwright (e2e) | No heavy test framework needed |

## Folder layout
```
src/
  app/(site)/          landing, catalog (header/footer layout)
  app/store/           full-screen 3D store
  app/api/cart/price   server-side cart pricing
  components/          Providers, ProductCard, CartButton, MarketSwitch
  features/store3d/    layout.ts (pure), StoreScene, Player, Interactor, interactables, ui-store, hud/*
  features/cart/       cart store (ids+qty only), priced-cart hook, CartDrawer
  lib/catalog/source   Supabase catalog loader (+ source-map.ts pure mapping)
  lib/money.ts         integer minor-unit money (DONE)
  lib/catalog/         types + mock catalog (DONE) → Supabase reader (Phase 2)
  lib/cart/pricing.ts  server-side pricing/stock/discount/tax (DONE)
  lib/orders/          state machine + audit (DONE)
  lib/suppliers/       adapter contract, retry/timeout, idempotent fulfillment, mock (DONE)
  lib/payments/        provider contract, dev simulator, webhook handler (DONE)
supabase/migrations/   SQL migrations + RLS (Phase 2)
tests/unit, tests/e2e
```

## 3D
- `/store` loads the canvas lazily (`next/dynamic`, `ssr:false`); the site never waits on 3D.
- Capability check (WebGL2, device memory, reduced motion) → fallback to `/catalog` grid.
- Store layout is data: sections → aisles → shelves → slots (`store_layout` table, edited in admin).
- Products on shelves: `<Instances>` per GLB; products without a real GLB render a labelled placeholder box.
- Interaction: one `InteractionManager`; a center-screen raycast (crosshair) + max range picks exactly one target, shows one prompt, `E` triggers it.
- **First-person**: pointer-lock mouse look (drei `PointerLockControls`), Rapier capsule with kinematic character controller, camera at eye height (~1.65 m), WASD + Shift run, head-bob subtle/optional, no player mesh needed (optional hands/cart model later). Esc releases pointer and opens UI; product panel/cart overlays pause input.

## Markets
- Business based in Italy; sells to EU-27 (EUR, VAT-inclusive prices) and USA (USD, tax-exclusive). `src/lib/markets.ts`.
- Tax rates live in `tax_rates` (per country / US state) and must be confirmed by the accountant (EU OSS, US nexus). Stripe Tax is an alternative later.

## Commerce rules (enforced in lib/)
- Money: integer minor units + currency; never floats.
- Client sends only `{variantId, quantity}`; server reprices with `priceCart`.
- Order status changes only via `transitionOrder`; `paid` needs verified payment id, `shipped` needs carrier + tracking.
- Order items snapshot name/SKU/price at purchase.

## Data model — `supabase/migrations` (written + tested locally, not yet pushed)
profiles, user_roles · categories, products, product_variants, variant_prices (EUR+USD), product_images, product_3d_assets, inventory, tax_rates · carts, cart_items · addresses · orders, order_items (snapshots), order_status_events (audit) · payments, payment_events (UNIQUE provider_event_id) · suppliers, supplier_credentials (service-role only), supplier_products, supplier_orders (UNIQUE idempotency_key), shipments · discounts, discount_redemptions · store_layout · admin_audit_logs.
RLS: customers read/write only their own rows; admin via `user_roles`; credentials never readable from any client. DB triggers enforce order transitions, immutable order amounts/items, append-only audit. Stock via `reserve_inventory`/`commit_inventory` (server only).

## Suppliers
`SupplierAdapter` declares `capabilities`; unsupported ops → manual fallback. `submitToSupplier` reserves an idempotency key before calling the supplier, retries only retryable errors, and sends timeouts to manual reconciliation (never blind resubmits). Real adapters only with real API docs + credentials.

## Payments
`PaymentProvider` interface (session, verifyWebhook on raw body, status, refund). **Stripe** (`lib/payments/stripe.ts`, REST via fetch): Checkout Session for the server-computed total, Stripe-Signature verification, events `checkout.session.completed` / `async_payment_succeeded|failed` / `charge.refunded`. Live keys refused unless `allowLive`. Dev simulator remains for offline work. `handlePaymentWebhook`: verify → dedupe event → match amount → transition.

## Admin dashboard (2026-11-21)
- **Data access**: server-only `postgres` client (`src/lib/db/client.ts`, `DATABASE_URL`, bigint → safe-integer numbers). Admin services in `src/lib/admin/services/*` take a `Db` (pool or transaction) so they compose atomically; pure rules live in `lib/shipping/quote.ts`, `lib/suppliers/split.ts`, `lib/coupons/validate.ts`, `lib/fx.ts`, `lib/finance/profit.ts`, `lib/csv.ts`.
- **Catalog source**: `getCatalog()` prefers `DATABASE_URL` (`lib/catalog/sql-source.ts`, same row shape as PostgREST → shared `mapProductRow`), then Supabase REST, then mock. Admin edits `revalidatePath` `/`, `/catalog`, `/store`.
- **Auth**: `admin_users` / `admin_sessions` (separate from storefront `auth.users`), scrypt, sha256-hashed session tokens, lockout. `lib/admin/guard.ts`: `requirePage(permission)` on every page, `adminAction(permission, zodSchema, fn)` on every mutation, `requireApi` for CSV routes. Append-only `admin_activity_log` with before/after.
- **Orders**: `createOrder` (server pricing, coupon, shipping, tax rate required, fx snapshot, `reserve_order_inventory` all-or-nothing) and `transitionOrderInDb` = `transitionOrder` (TS rules) + DB `transition_order` (lock + audit; trigger re-checks) + inventory effects (`settle_order_inventory`: release on cancel/failed payment/refund, commit on ship). Admins can't set `paid`/`refunded` by hand.
- **Fulfillment**: paid order → `createSupplierOrders` splits by primary supplier mapping into idempotent `supplier_orders` (+ `supplier_order_items`); manual mode records the supplier ref; all submitted → `submitted_to_supplier`; shipment with real tracking → `shipped`.
- **Payments**: `/api/webhooks/[provider]` → `handlePaymentWebhook` + `pgWebhookStore` inside ONE transaction (dedupe row rolls back if applying fails). Refunds only through the provider (or recorded as manual with the provider's reference).
- **3D**: `product_shelf_placements` (face pin, priority, hidden) extends `buildStoreLayout`; `store.stock_all_faces` setting.
- **Local Postgres**: `tools/db/embedded.ts` (embedded-postgres + `supabase/local/supabase_stubs.sql` + migrations) for dev, integration tests and e2e.

# Dropshipping engine — audit, design, setup, limits

Last updated 2026-11-22. Code: `src/lib/fulfillment/*`, `src/lib/suppliers/*`, admin `/admin/dropshipping`.
Migration: `supabase/migrations/20261125000001_dropshipping_automation.sql` (additive only).

## 1. Audit (before this work)

**Stack.** Next.js 16 (App Router) on Vercel · Postgres via Supabase (direct `postgres` client, RLS on, server-only tables) ·
own admin auth (`admin_users`, roles + permissions) · Stripe Checkout (REST, no SDK) · Resend email outbox · R3F 3D store.

**Already working (kept as-is):**
- Server-side pricing, atomic stock reservation, integer money (`money.ts`, `fx.ts`).
- Order state machine (`orders/state-machine.ts`) + DB `transition_order` + triggers; `paid` only from a verified webhook.
- Stripe webhook: signature check over the raw body, dedupe (`payment_events` UNIQUE), PaymentIntent re-check, refunds/disputes flagged, fees from balance transactions.
- Fulfillment gate: supplier orders refused (app + DB trigger) without a verified, re-checked payment.
- Supplier adapter contract, idempotent submission (`supplier_orders.idempotency_key` UNIQUE), split by supplier, manual flow (record supplier ref + tracking), shipment → shipped/delivered emails.
- Profit report (revenue net of tax − supplier cost − fees − refunds − expenses), multi-currency via `exchange_rates`.

**Gaps found:**
- Fulfillment was admin-triggered only — no automatic purchasing, no job queue, no retries, no exception queue, no kill switch, no purchasing rules.
- No real supplier adapters (manual + mock only); mappings had no supplier product/variant ids, shipping method, priority/backup.
- No status/tracking sync from suppliers; no tracking events.
- Supplier *payment* not modelled (placing an order ≠ paying for it).

**Risks found & fixed:**
- **Duplicate purchase on timeout** (existing code): a supplier submission that timed out was retried automatically up to 3× by `callSupplier`. A timeout may mean the supplier *did* create the order (AliExpress has no idempotency key) → possible double purchase. Now submissions are never auto-retried after a timeout; they go to manual review ("confirm with the supplier").
- Cron routes only daily on Vercel Hobby → added `/api/cron/fulfillment` + a post-webhook kick (`after()`), see §6.

**Remaining risks (not code):** Supabase secret key / DB password were shared in chat earlier — rotate them (see PROJECT_STATUS). Legal entity / Stripe eligibility — see §5.

## 2. Status mapping

The customer-facing `order_status` enum was **not** changed (no destructive migration; emails, triggers, UI depend on it).
The finer automation stages live on `fulfillment_jobs` and `supplier_orders`:

| Requested state | Where it lives |
|---|---|
| PENDING_PAYMENT | order `pending_payment` |
| PAYMENT_CONFIRMED | order `paid` (verified webhook only) |
| FULFILLMENT_PENDING | job `queued` |
| FULFILLMENT_PROCESSING | order `processing` + job `running` |
| SUPPLIER_ORDER_CREATED | order `submitted_to_supplier`, supplier order `submitted` |
| SUPPLIER_PAYMENT_PENDING | `supplier_orders.supplier_payment_status = pending` (job stage `awaiting_supplier_payment`) |
| SUPPLIER_PAID | `supplier_payment_status = paid` → order `supplier_accepted` |
| SHIPPED / IN_TRANSIT | order `shipped`; shipment `in_transit` / `out_for_delivery` + `tracking_events` |
| DELIVERED | order `delivered` (all shipments delivered) |
| FULFILLMENT_FAILED | order `failed` and/or job `failed` (dead letter) |
| MANUAL_REVIEW | job `manual_review` (exception queue) |
| REFUND_PENDING / REFUNDED / CANCELLED | order `refund_requested` / `refunded` / `cancelled` |

## 3. How automatic fulfillment works

1. Stripe webhook verified → order `paid` → **in the same DB transaction** one `fulfillment_jobs` row (UNIQUE `order_id`). Duplicate webhooks are deduped before this; even a second `paid` cannot create a second job.
2. Worker (`processDueFulfillmentJobs`) claims due jobs with `FOR UPDATE SKIP LOCKED` + 5-min lease. Runs after the webhook response (`after()`) and from cron — never inside checkout.
3. Per job: kill switch → automation on? → order still fulfillable → **payment re-verified with Stripe** → previous attempts (anything `submitting`/`manual_required` ⇒ stop, never re-plan) → destination allowed → address complete (phone required for AliExpress) → per line: candidates (primary, then backups by priority) checked against **live** stock + price (max price increase), supplier countries, auto-fulfil flag, shipping method allowed → per supplier: margin after supplier cost + supplier shipping + payment fee, max purchase amount, FX available → kill switch again → idempotent submission.
4. Outcomes: submitted ⇒ job `succeeded`, supplier payment `pending` + admin alert "pay the supplier"; any check fails ⇒ `manual_review` + alert with reasons; transient API errors ⇒ retry with exponential backoff (1, 2, 4… min, cap 6 h) up to `maxAttempts` ⇒ `failed` (dead letter) + critical alert.
5. Sync (`syncSupplierOrders`): supplier status → payment detected → `supplier_accepted`; real tracking number → shipment + events → `shipped` (customer email) → `delivered` (email). Supplier cancel/reject ⇒ order `failed` + critical alert. Unknown statuses ⇒ alert, nothing assumed.
6. Every step is written to `automation_logs` (append-only) and shown on `/admin/dropshipping`.

**Purchasing rules** (Admin → Dropshipping): max price increase %, min margin %, max purchase amount, allowed countries, allowed shipping methods, attempts, backup suppliers on/off, fee estimate. **Defaults: automation OFF.** Kill switch stops all submissions instantly; jobs wait, nothing is lost.

## 4. Suppliers — what is real

| Supplier | Status | Places orders | Pays supplier |
|---|---|---|---|
| **AliExpress (DS API)** | Adapter implemented (`suppliers/aliexpress/*`), unit-tested against fakes only. **Not verified against the live API.** | Yes, `aliexpress.trade.buy.placeorder` | **No.** DS API orders are created unpaid; you pay them in your AliExpress buyer account. Sync detects payment. |
| **Alibaba.com** | Manual (`alibaba` key). The ICBU dropshipping API (`alibaba.buynow.order.create`, `alibaba.dropshipping.*`) needs partner approval; parameter specs were not available to build against. | No — place in the Alibaba Dropshipping console (Bulk Create Order), record the order number | No |
| **DSers** | Not integrated. DSers' Open API requires its Developer Program + app review; no public order-placement spec for custom stores. Use the AliExpress DS API directly (DSers itself uses it). | — | — |
| Manual | Real | You place it | You pay |
| Mock | Dev/test only, disabled in production | — | — |

### Connect AliExpress
1. Create an app on the AliExpress Open Platform (openservice.aliexpress.com) and apply for the **Dropshipping** API permission.
2. Authorise the app with your **AliExpress buyer account** (OAuth) → access token. Note its expiry; refresh before it lapses.
3. Server env (Vercel → Settings → Environment Variables, *not* `NEXT_PUBLIC_`): `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET`, `ALIEXPRESS_ACCESS_TOKEN` (optional `ALIEXPRESS_API_URL`, `ALIEXPRESS_CURRENCY`).
4. In your app's API console, **verify** the method names/parameters used in `suppliers/aliexpress/adapter.ts` (header comment) — adjust if your console differs.
5. Admin → Suppliers → add supplier, integration "AliExpress", mode **api**, active; set destination countries.
6. Map each variant: Our SKU, supplier SKU (any label), **supplier product id** (number in the product URL), **variant id** (`sku_attr`), **shipping method** (e.g. `CAINIAO_STANDARD`), unit cost (USD) + shipping cost, primary/backup priority.
7. Place a **real but cheap test order with automation OFF**, press "Retry automatically" on it in the queue with automation ON for that one order, confirm the order appears unpaid in AliExpress, pay it, run the worker, confirm sync.

## 5. Payments

- Stripe is kept (modular provider interface `lib/payments/types.ts`; the order engine depends only on that interface).
- **Eligibility:** PROJECT_STATUS records the business as Italy-based (Stripe supports Italy). **Stripe does not list Tunisia** as a supported country for merchant accounts — if the legal entity/bank is Tunisian, do not open Stripe with another country's details. Options: register the business where Stripe operates (e.g. an EU or US entity with a local bank), or a provider that onboards Tunisian merchants (verify current terms directly; e.g. local acquirers/gateways such as those of Tunisian banks, or international PSPs that accept your entity). Swapping providers = a new `PaymentProvider` implementation + webhook; no order-engine change.
- Webhook endpoint: `https://<domain>/api/webhooks/stripe`. Events: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`. Secret → `STRIPE_WEBHOOK_SECRET`. Live mode additionally needs `STRIPE_ALLOW_LIVE=true`.

## 6. Scheduling

- `GET /api/cron/fulfillment` (Bearer `CRON_SECRET`): jobs + tracking sync + emails. Run every 5–15 min. Vercel Hobby only allows daily crons → use Vercel Pro (`vercel.json` crons) or an external scheduler (e.g. GitHub Actions / cron service) sending `Authorization: Bearer $CRON_SECRET`.
- `GET /api/cron/maintenance` (daily, already in `vercel.json`) also runs a backstop pass.
- The payment webhook kicks the worker right after responding.

## 7. Environment variables (names only)

`DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ALLOW_LIVE`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `CRON_SECRET`, `ORDER_LINK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_SITE_URL`, `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET`, `ALIEXPRESS_ACCESS_TOKEN`, `ALIEXPRESS_API_URL`, `ALIEXPRESS_CURRENCY`. `npm run check:env` validates by name (never prints values).

## 8. Tests (2026-11-22)

- Unit `tests/unit/dropshipping.test.ts` (9): rules, price increase, margin, limits, address, backoff; IOP signing; AliExpress product/variant/price/stock parsing, order placement payload, refusal handling, status mapping (FINISH without tracking ≠ delivered), split orders.
- Integration `tests/integration/dropshipping.test.ts` (7, real Postgres, mock supplier): happy path payment → job → supplier order → payment detected → shipped (one email) → delivered; duplicate webhook; kill switch; price increase → review; out of stock → backup supplier; bad address / automation off / unmapped → review; timeout never resubmitted; 503 → retried, one supplier order; supplier cancel → failed + alert.
- Not tested: live AliExpress API, live Stripe → hosted webhook on Vercel, real carriers.

Covered by existing suites: failed payment, duplicate order submission (checkout idempotency), refunds, unauthorized admin access, currency conversion, profit calculation.

## 9. Production checklist

1. Rotate Supabase secret key + DB password. 2. `npx supabase db push` (this migration) **before** deploying the code (the webhook writes `fulfillment_jobs`). 3. Set env vars (§7); `npm run check:env`. 4. Stripe live activation + webhook events (§5). 5. Exchange rates EUR↔USD in Admin → Payments/Reports (needed for USD supplier costs on EUR orders). 6. Scheduler for `/api/cron/fulfillment`. 7. Connect AliExpress (§4) and map variants. 8. Purchasing rules. 9. One test order end-to-end with automation OFF, then ON. 10. Turn automation ON. Know where the kill switch is.

## 10. Limitations / manual approvals

- Supplier payment is **never automated** (no official API path found that pays DS orders). You must pay supplier orders; the dashboard lists them and alerts after 12 h.
- AliExpress adapter not yet run against the live API; method/param names come from AliExpress's public DS API listing and must be checked in your console.
- Alibaba.com and DSers are manual / not integrated (see §4).
- Supplier refunds/cancellations: not automated (adapters expose `cancelOrder` / `requestRefund` hooks; AliExpress disputes are opened in the AliExpress UI).
- Inventory/price sync runs per order (live check before purchase), not as a scheduled catalogue-wide sync yet.
- Supplier costs must be EUR or USD (DB currency domain); other currencies are refused, never guessed.
- Customer tracking page: signed order link / emailed order-history link (no customer accounts yet).

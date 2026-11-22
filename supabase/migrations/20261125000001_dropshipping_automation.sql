-- Dropshipping automation: fulfillment job queue, automation log, tracking events, richer supplier mappings.
-- Additive only (new tables, new nullable/defaulted columns, new settings rows). No data is modified or deleted.
-- The customer-facing order status enum is unchanged; the finer automation stages live on fulfillment_jobs
-- and supplier_orders (see DROPSHIPPING.md → "Status mapping").
--
-- Rollback (manual, if ever needed):
--   drop table if exists public.tracking_events, public.automation_logs, public.fulfillment_jobs;
--   alter table public.supplier_products drop column if exists supplier_product_id, drop column if exists supplier_variant_id,
--     drop column if exists shipping_cost_amount, drop column if exists shipping_method, drop column if exists priority,
--     drop column if exists auto_fulfill, drop column if exists last_live_cost, drop column if exists last_live_available;
--   alter table public.suppliers drop column if exists supported_countries, drop column if exists api_status,
--     drop column if exists api_checked_at, drop column if exists api_error;
--   alter table public.supplier_orders drop column if exists supplier_payment_status, drop column if exists supplier_status_raw,
--     drop column if exists shipping_cost, drop column if exists last_synced_at, drop column if exists next_sync_at,
--     drop column if exists sync_failures;
--   delete from public.store_settings where key in ('fulfillment.automation', 'fulfillment.rules');

-- ───────────────────────── Supplier mappings: real supplier ids, variants, priority ─────────────────────────
alter table public.supplier_products
  add column if not exists supplier_product_id text check (char_length(supplier_product_id) <= 64),   -- e.g. AliExpress product id
  add column if not exists supplier_variant_id text check (char_length(supplier_variant_id) <= 500), -- e.g. AliExpress sku_attr / sku id
  add column if not exists shipping_cost_amount bigint check (shipping_cost_amount >= 0),             -- expected, in cost_currency
  add column if not exists shipping_method text check (char_length(shipping_method) <= 120),         -- supplier logistics service name
  add column if not exists priority int not null default 0 check (priority between 0 and 100),       -- 0 = first choice (backups > 0)
  add column if not exists auto_fulfill boolean not null default true,
  add column if not exists last_live_cost bigint check (last_live_cost >= 0),
  add column if not exists last_live_available int check (last_live_available >= 0);

alter table public.suppliers
  add column if not exists supported_countries text[] not null default '{}',  -- empty = any country allowed by the rules
  add column if not exists api_status text not null default 'not_connected'
    check (api_status in ('not_connected', 'connected', 'error', 'not_applicable')),
  add column if not exists api_checked_at timestamptz,
  add column if not exists api_error text;

alter table public.supplier_orders
  -- Supplier payment is tracked separately: creating an order at the supplier is not the same as paying for it.
  add column if not exists supplier_payment_status text not null default 'unknown'
    check (supplier_payment_status in ('unknown', 'pending', 'paid', 'failed', 'not_required')),
  add column if not exists supplier_status_raw text,
  add column if not exists shipping_cost bigint check (shipping_cost >= 0),
  add column if not exists last_synced_at timestamptz,
  add column if not exists next_sync_at timestamptz,
  add column if not exists sync_failures int not null default 0 check (sync_failures >= 0);
create index if not exists supplier_orders_sync_due on public.supplier_orders (next_sync_at) where status = 'submitted';

-- ───────────────────────── Fulfillment job queue ─────────────────────────
-- One automatic-fulfillment job per order (UNIQUE order_id): a duplicated payment webhook can never create
-- a second job, and the supplier submission itself is idempotent (supplier_orders.idempotency_key).
create table public.fulfillment_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'manual_review', 'failed', 'cancelled')),
  stage text,                                    -- last step reached (validate_address, check_supplier, submit, …)
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts between 1 and 20),
  next_run_at timestamptz not null default now(),
  locked_until timestamptz,                      -- lease; a crashed worker's job is picked up again after it expires
  last_error text,
  review_reason text,                            -- why it is in the exception queue
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fulfillment_jobs_due on public.fulfillment_jobs (next_run_at) where status in ('queued', 'running');
create index fulfillment_jobs_review on public.fulfillment_jobs (status) where status in ('manual_review', 'failed');
create trigger t_fulfillment_jobs_updated before update on public.fulfillment_jobs for each row execute function public.set_updated_at();

-- ───────────────────────── Automation log (append-only) ─────────────────────────
create table public.automation_logs (
  id bigint generated always as identity primary key,
  order_id uuid references public.orders(id) on delete set null,
  job_id uuid references public.fulfillment_jobs(id) on delete set null,
  supplier_order_id uuid references public.supplier_orders(id) on delete set null,
  level text not null default 'info' check (level in ('info', 'warn', 'error')),
  event text not null check (char_length(event) <= 80),
  message text not null check (char_length(message) <= 1000),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.automation_logs (order_id, created_at);
create index on public.automation_logs (created_at desc);
create trigger automation_logs_append_only before update or delete on public.automation_logs
  for each row execute function public.prevent_mutation();

-- ───────────────────────── Tracking events ─────────────────────────
create table public.tracking_events (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  status text not null check (status in ('label_created', 'in_transit', 'out_for_delivery', 'delivered', 'exception')),
  description text not null default '' check (char_length(description) <= 500),
  location text check (char_length(location) <= 200),
  occurred_at timestamptz not null,
  source text not null default 'supplier_sync' check (source in ('supplier_sync', 'admin', 'carrier')),
  created_at timestamptz not null default now(),
  unique (shipment_id, occurred_at, status, description)
);
create index on public.tracking_events (shipment_id, occurred_at);

-- ───────────────────────── RLS: server only (no policies) ─────────────────────────
alter table public.fulfillment_jobs enable row level security;
alter table public.automation_logs enable row level security;
alter table public.tracking_events enable row level security;

-- ───────────────────────── Defaults (safe: automation OFF until the owner turns it on) ─────────────────────────
insert into public.store_settings (key, value) values
  ('fulfillment.automation', '{"enabled": false, "killSwitch": false}'),
  ('fulfillment.rules', '{"maxPriceIncreaseBps": 1000, "minMarginBps": 1500, "maxPurchaseAmount": 20000, "maxPurchaseCurrency": "USD", "allowedCountries": [], "allowedShippingMethods": [], "maxAttempts": 5, "useBackupSuppliers": true}')
on conflict (key) do nothing;

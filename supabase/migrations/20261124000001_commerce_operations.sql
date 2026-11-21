-- Phase 2: commercial operations. Additive only (new nullable columns + indexes); no data is modified.
--
-- Rollback (manual):
--   alter table public.orders drop column if exists tax_rate_bps, drop column if exists tax_country, drop column if exists tax_region,
--     drop column if exists billing_address, drop column if exists shipping_min_days, drop column if exists shipping_max_days;
--   drop index if exists public.email_outbox_dedupe; alter table public.email_outbox drop column if exists dedupe_key;
--   drop index if exists public.orders_email_lower_idx;

-- Tax snapshot: the rate and jurisdiction actually applied at purchase (never recomputed later).
alter table public.orders
  add column if not exists tax_rate_bps int check (tax_rate_bps between 0 and 10000),
  add column if not exists tax_country text check (tax_country ~ '^[A-Z]{2}$'),
  add column if not exists tax_region text check (char_length(tax_region) <= 60),
  -- Billing address (null = same as shipping). Snapshot at purchase.
  add column if not exists billing_address jsonb,
  -- Delivery ESTIMATE shown at checkout (business days, from the admin-configured method). Not a guarantee.
  add column if not exists shipping_min_days int check (shipping_min_days >= 0),
  add column if not exists shipping_max_days int check (shipping_max_days >= shipping_min_days);

-- Customer order history by e-mail (signed links).
create index if not exists orders_email_lower_idx on public.orders (lower(email), created_at desc);

-- One e-mail per event (status change / refund), even if the event is processed twice.
alter table public.email_outbox add column if not exists dedupe_key text;
create unique index if not exists email_outbox_dedupe on public.email_outbox (dedupe_key) where dedupe_key is not null;

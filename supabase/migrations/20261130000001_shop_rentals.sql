-- Rental shops in the 3D store: brands rent one of the shop units (store3d/env/shops.ts) for 1, 3 or 12 months.
-- One row per booking (a renewal is a new row that continues the previous one). Amounts are integer minor units,
-- computed on the server (lib/rentals/pricing.ts). A lease becomes `active` ONLY through a verified payment webhook.
-- Additive only: one new table. No existing data is modified.
--
-- Rollback (manual, if ever needed):
--   drop table if exists public.shop_leases;

create table public.shop_leases (
  id uuid primary key default gen_random_uuid(),
  -- Short reference shown to the tenant and on the payment page, e.g. RS-7K3QF2.
  reference text not null unique check (reference ~ '^RS-[0-9A-Z]{6}$'),
  shop_id text not null check (shop_id ~ '^shop-[0-9]{1,2}$'),
  plan text not null check (plan in ('monthly', 'quarterly', 'yearly')),
  months int not null check (months between 1 and 24),
  currency text not null check (currency in ('EUR', 'USD')),
  amount int not null check (amount > 0),                 -- charged for the whole term
  regular_amount int not null check (regular_amount >= amount),
  promo_name text check (promo_name is null or char_length(promo_name) <= 60),
  -- pending_payment → active (webhook) | expired_unpaid | cancelled; active → cancelled | refunded;
  -- payment_review = money received but the lease could not be activated (e.g. someone else rented it): admin decides.
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'active', 'cancelled', 'expired_unpaid', 'refunded', 'payment_review')),

  brand_name text not null check (char_length(brand_name) between 2 and 60),
  contact_name text not null check (char_length(contact_name) between 2 and 120),
  email text not null check (char_length(email) between 3 and 254),
  phone text check (phone is null or char_length(phone) <= 40),
  website text check (website is null or char_length(website) <= 300),
  category text not null check (char_length(category) between 2 and 60),
  description text not null check (char_length(description) between 20 and 1500),
  country text not null check (country ~ '^[A-Z]{2}$'),
  company_name text check (company_name is null or char_length(company_name) <= 160),
  vat_id text check (vat_id is null or char_length(vat_id) <= 40),
  user_id uuid,

  -- Shown on the shop's 3D sign once approved by an admin (defaults to the brand name).
  display_name text check (display_name is null or char_length(display_name) <= 40),
  display_approved boolean not null default false,

  renews_lease_id uuid references public.shop_leases(id) on delete set null,
  provider text,
  provider_session_id text,
  provider_payment_id text,
  is_test boolean not null default false,
  refunded_amount int not null default 0 check (refunded_amount >= 0 and refunded_amount <= amount),

  terms_accepted_at timestamptz not null,
  hold_expires_at timestamptz not null,
  paid_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  check ((starts_at is null) = (ends_at is null) and (ends_at is null or ends_at > starts_at)),
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  admin_note text check (admin_note is null or char_length(admin_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shop_leases_shop on public.shop_leases (shop_id, status, ends_at);
create index shop_leases_created on public.shop_leases (created_at desc);
create unique index shop_leases_payment on public.shop_leases (provider, provider_payment_id) where provider_payment_id is not null;
create index shop_leases_email on public.shop_leases (lower(email));

-- Server-only (the app talks to Postgres directly); no public access through the Supabase API.
alter table public.shop_leases enable row level security;
revoke all on public.shop_leases from anon, authenticated;

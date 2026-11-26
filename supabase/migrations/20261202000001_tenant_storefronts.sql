-- Renter ("tenant") storefronts: the brands renting a shop in the 3D store manage their shop from /seller.
-- One tenant account per signed-in customer (Supabase auth user); its storefront is shown in every shop that user
-- rents (shop_leases.user_id). Products are sold through the tenant's OWN payment links (Stripe Payment Links,
-- PayPal, Shopify, ...): the money never passes through this platform; we only count views and "Buy" clicks.
-- The platform charges each tenant an optional fixed monthly fee on top of rent (set by the super admin, added to
-- the next rent payment; recorded per lease in shop_leases.fee_amount). Amounts are integer minor units.
-- Additive only: three new tables and one new column with a default. No existing data is modified.
--
-- Rollback (manual, if ever needed):
--   drop table if exists public.tenant_product_stats; drop table if exists public.tenant_products;
--   drop table if exists public.tenant_accounts; alter table public.shop_leases drop column if exists fee_amount;

create table public.tenant_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  brand_name text not null check (char_length(brand_name) between 2 and 60),
  tagline text check (tagline is null or char_length(tagline) <= 90),
  about text check (about is null or char_length(about) <= 1500),
  accent_color text not null default '#f7c416' check (accent_color ~ '^#[0-9a-f]{6}$'),
  logo_bucket text,
  logo_path text,
  check ((logo_bucket is null) = (logo_path is null)),
  website text check (website is null or char_length(website) <= 300),
  instagram text check (instagram is null or char_length(instagram) <= 60),
  tiktok text check (tiktok is null or char_length(tiktok) <= 60),
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 40),
  -- Used for any product without its own link (e.g. a whole-shop Stripe/PayPal/Shopify page).
  default_payment_url text check (default_payment_url is null or (char_length(default_payment_url) <= 600 and default_payment_url ~ '^https://')),
  -- The tenant opens the shop to shoppers when ready; the super admin can suspend it (overrides open).
  storefront_open boolean not null default false,
  suspended boolean not null default false,
  suspended_reason text check (suspended_reason is null or char_length(suspended_reason) <= 300),
  -- Platform fee per month, in the currency of the tenant's lease; 0 = none.
  monthly_fee int not null default 0 check (monthly_fee between 0 and 10000000),
  admin_note text check (admin_note is null or char_length(admin_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant_accounts(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 80),
  description text check (description is null or char_length(description) <= 1000),
  price int not null check (price between 0 and 100000000),
  currency text not null check (currency in ('EUR', 'USD')),
  image_bucket text,
  image_path text,
  check ((image_bucket is null) = (image_path is null)),
  payment_url text check (payment_url is null or (char_length(payment_url) <= 600 and payment_url ~ '^https://')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  -- Super admin moderation: hidden products never show in the store, whatever their status.
  hidden_by_admin boolean not null default false,
  hidden_reason text check (hidden_reason is null or char_length(hidden_reason) <= 300),
  sort int not null default 0,
  views int not null default 0 check (views >= 0),
  buy_clicks int not null default 0 check (buy_clicks >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tenant_products_tenant on public.tenant_products (tenant_id, sort, created_at);

-- Daily views / "Buy" clicks per product (dashboard charts).
create table public.tenant_product_stats (
  product_id uuid not null references public.tenant_products(id) on delete cascade,
  day date not null,
  views int not null default 0 check (views >= 0),
  buy_clicks int not null default 0 check (buy_clicks >= 0),
  primary key (product_id, day)
);

alter table public.shop_leases add column fee_amount int not null default 0 check (fee_amount >= 0);

-- Server-only (the app talks to Postgres directly); no public access through the Supabase API.
alter table public.tenant_accounts enable row level security;
alter table public.tenant_products enable row level security;
alter table public.tenant_product_stats enable row level security;
revoke all on public.tenant_accounts from anon, authenticated;
revoke all on public.tenant_products from anon, authenticated;
revoke all on public.tenant_product_stats from anon, authenticated;

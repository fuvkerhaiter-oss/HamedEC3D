-- Virtual Shopping World — core schema
-- Money: bigint minor units + ISO currency. Never floats.
-- Security: RLS on every table. Server code uses the secret key (service_role) for privileged writes.

create extension if not exists pgcrypto;

-- ───────────────────────── Enums ─────────────────────────
create type public.app_role as enum ('admin', 'staff');
create type public.product_status as enum ('draft', 'published', 'archived');
create type public.order_status as enum (
  'pending_payment','paid','processing','submitted_to_supplier','supplier_accepted',
  'shipped','delivered','cancelled','refund_requested','refunded','failed');
create type public.payment_status as enum ('pending','succeeded','failed','refunded','partially_refunded');
create type public.supplier_order_status as enum ('submitting','submitted','failed','manual_required');
create type public.discount_kind as enum ('percent','fixed');
create type public.tax_mode as enum ('inclusive','exclusive');

create domain public.currency_code as char(3) check (value in ('EUR','USD'));
create domain public.country_code as char(2) check (value ~ '^[A-Z]{2}$');

-- ───────────────────────── Helpers ─────────────────────────
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ───────────────────────── Identity ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text check (char_length(full_name) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin','staff'));
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── Catalog ─────────────────────────
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  parent_id uuid references public.categories(id) on delete set null,
  sort_order int not null default 0
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null check (char_length(name) between 1 and 200),
  description text not null default '',
  category_id uuid references public.categories(id) on delete set null,
  status public.product_status not null default 'draft',
  is_mock boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.products (category_id) where status = 'published';

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,
  name text not null,
  attributes jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.product_variants (product_id);

-- One price per currency. EUR prices are VAT-inclusive, USD prices are tax-exclusive.
create table public.variant_prices (
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  currency public.currency_code not null,
  amount bigint not null check (amount >= 0),
  compare_at_amount bigint check (compare_at_amount is null or compare_at_amount >= 0),
  primary key (variant_id, currency)
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null,
  alt text not null default '',
  sort_order int not null default 0
);
create index on public.product_images (product_id);

create table public.product_3d_assets (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null,
  height_m numeric(6,3) not null check (height_m > 0 and height_m < 10),
  triangle_count int check (triangle_count >= 0),
  file_bytes bigint check (file_bytes >= 0),
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index product_3d_assets_one_primary on public.product_3d_assets (product_id) where is_primary;

create table public.inventory (
  variant_id uuid primary key references public.product_variants(id) on delete cascade,
  quantity int not null default 0 check (quantity >= 0),
  reserved int not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now(),
  check (reserved <= quantity)
);

-- ───────────────────────── Tax & markets ─────────────────────────
-- Rates are business configuration, confirmed by the accountant (EU OSS / US state nexus).
create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  country public.country_code not null,
  region text,               -- US state code, null = whole country
  mode public.tax_mode not null,
  basis_points int not null check (basis_points between 0 and 5000),
  tax_shipping boolean not null default true,
  is_active boolean not null default true,
  note text
);
create unique index tax_rates_unique on public.tax_rates (country, coalesce(region, '')) where is_active;

-- ───────────────────────── Suppliers ─────────────────────────
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  adapter_key text not null,          -- maps to a SupplierAdapter implementation
  is_active boolean not null default false,
  is_mock boolean not null default false,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Secrets are kept in Supabase Vault; this table stores only the Vault secret name.
-- No RLS policies: readable only with the secret key on the server.
create table public.supplier_credentials (
  supplier_id uuid primary key references public.suppliers(id) on delete cascade,
  vault_secret_name text not null unique,
  updated_at timestamptz not null default now()
);

create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  supplier_sku text not null,
  cost_amount bigint not null check (cost_amount >= 0),
  cost_currency public.currency_code not null,
  shipping_days_min int check (shipping_days_min >= 0),
  shipping_days_max int check (shipping_days_max >= shipping_days_min),
  is_primary boolean not null default true,
  last_synced_at timestamptz,
  unique (supplier_id, supplier_sku)
);
create unique index supplier_products_one_primary on public.supplier_products (variant_id) where is_primary;

-- ───────────────────────── Customers ─────────────────────────
create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  line1 text not null,
  line2 text,
  city text not null,
  region text,
  postal_code text not null,
  country public.country_code not null,
  phone text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.addresses (user_id);
create unique index addresses_one_default on public.addresses (user_id) where is_default;

-- ───────────────────────── Carts ─────────────────────────
create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  guest_token_hash text unique,       -- sha256 of an httpOnly cookie token; guests go through the server only
  currency public.currency_code not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((user_id is not null) <> (guest_token_hash is not null))
);
create unique index carts_one_per_user on public.carts (user_id) where user_id is not null;

create table public.cart_items (
  cart_id uuid not null references public.carts(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  quantity int not null check (quantity between 1 and 99),
  added_at timestamptz not null default now(),
  primary key (cart_id, variant_id)
);

-- ───────────────────────── Discounts ─────────────────────────
create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  kind public.discount_kind not null,
  basis_points int check (basis_points between 1 and 10000),
  amount bigint check (amount > 0),
  currency public.currency_code,
  min_subtotal bigint check (min_subtotal >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions int check (max_redemptions > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((kind = 'percent' and basis_points is not null and amount is null)
      or (kind = 'fixed' and amount is not null and currency is not null and basis_points is null)),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create unique index discounts_code_ci on public.discounts (lower(code));

-- ───────────────────────── Orders ─────────────────────────
create sequence public.order_number_seq start 100001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint not null unique default nextval('public.order_number_seq'),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  status public.order_status not null default 'pending_payment',
  currency public.currency_code not null,
  tax_mode public.tax_mode not null,
  subtotal bigint not null check (subtotal >= 0),
  discount_total bigint not null default 0 check (discount_total >= 0),
  shipping_total bigint not null default 0 check (shipping_total >= 0),
  tax_total bigint not null default 0 check (tax_total >= 0),
  total bigint not null check (total >= 0),
  shipping_address jsonb not null,           -- snapshot at purchase
  ship_country public.country_code not null,
  discount_code text,
  checkout_idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discount_total <= subtotal),
  check (case tax_mode
           when 'exclusive' then total = subtotal - discount_total + shipping_total + tax_total
           else total = subtotal - discount_total + shipping_total end)
);
create index on public.orders (user_id, created_at desc);
create index on public.orders (status);

-- Historical snapshots: never joined back to live product data for display.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name text not null,
  variant_name text not null,
  sku text not null,
  unit_price bigint not null check (unit_price >= 0),
  quantity int not null check (quantity between 1 and 99),
  line_total bigint not null,
  check (line_total = unit_price * quantity)
);
create index on public.order_items (order_id);

-- Order audit trail (append-only).
create table public.order_status_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  actor_type text not null check (actor_type in ('system','admin','customer','payment_webhook','supplier_sync')),
  actor_id text,
  reason text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.order_status_events (order_id, created_at);

-- Mirror of src/lib/orders/state-machine.ts ORDER_TRANSITIONS — defence in depth.
create or replace function public.order_transition_allowed(f public.order_status, t public.order_status)
returns boolean language sql immutable as $$
  select case f
    when 'pending_payment'       then t in ('paid','cancelled','failed')
    when 'paid'                  then t in ('processing','refund_requested')
    when 'processing'            then t in ('submitted_to_supplier','failed','refund_requested')
    when 'submitted_to_supplier' then t in ('supplier_accepted','failed','refund_requested')
    when 'supplier_accepted'     then t in ('shipped','refund_requested')
    when 'shipped'               then t in ('delivered','refund_requested')
    when 'delivered'             then t in ('refund_requested')
    when 'refund_requested'      then t in ('refunded')
    when 'failed'                then t in ('processing','refund_requested','cancelled')
    else false end;
$$;

create or replace function public.guard_order_update() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status
     and not public.order_transition_allowed(old.status, new.status) then
    raise exception 'invalid order transition % -> %', old.status, new.status using errcode = 'check_violation';
  end if;
  -- Money and identity fields are immutable after creation.
  if (new.subtotal, new.discount_total, new.shipping_total, new.tax_total, new.total, new.currency, new.email, new.shipping_address)
     is distinct from
     (old.subtotal, old.discount_total, old.shipping_total, old.tax_total, old.total, old.currency, old.email, old.shipping_address) then
    raise exception 'order amounts and addresses are immutable' using errcode = 'check_violation';
  end if;
  new.updated_at = now();
  return new;
end $$;
create trigger orders_guard before update on public.orders for each row execute function public.guard_order_update();

create or replace function public.prevent_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name using errcode = 'check_violation'; end $$;
create trigger order_items_immutable before update on public.order_items for each row execute function public.prevent_mutation();
create trigger order_status_events_append_only before update or delete on public.order_status_events
  for each row execute function public.prevent_mutation();

-- Atomically apply a transition and write the audit row (called by the server with the secret key).
create or replace function public.transition_order(
  p_order_id uuid, p_to public.order_status, p_actor_type text, p_actor_id text, p_reason text, p_evidence jsonb)
returns public.order_status language plpgsql security definer set search_path = public as $$
declare v_from public.order_status;
begin
  select status into v_from from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  update public.orders set status = p_to where id = p_order_id;
  insert into public.order_status_events (order_id, from_status, to_status, actor_type, actor_id, reason, evidence)
  values (p_order_id, v_from, p_to, p_actor_type, p_actor_id, p_reason, coalesce(p_evidence, '{}'::jsonb));
  return p_to;
end $$;
revoke execute on function public.transition_order(uuid, public.order_status, text, text, text, jsonb) from public, anon, authenticated;

-- ───────────────────────── Inventory reservation ─────────────────────────
create or replace function public.reserve_inventory(p_variant uuid, p_qty int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_qty <= 0 then raise exception 'quantity must be positive'; end if;
  update public.inventory set reserved = reserved + p_qty, updated_at = now()
   where variant_id = p_variant and quantity - reserved >= p_qty;
  return found;
end $$;

create or replace function public.release_inventory(p_variant uuid, p_qty int) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.inventory set reserved = greatest(reserved - p_qty, 0), updated_at = now() where variant_id = p_variant;
end $$;

-- On shipment: convert reservation into a real decrement.
create or replace function public.commit_inventory(p_variant uuid, p_qty int) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.inventory set quantity = quantity - p_qty, reserved = reserved - p_qty, updated_at = now()
   where variant_id = p_variant and reserved >= p_qty and quantity >= p_qty;
  if not found then raise exception 'cannot commit % units of %', p_qty, p_variant; end if;
end $$;

revoke execute on function public.reserve_inventory(uuid, int), public.release_inventory(uuid, int),
  public.commit_inventory(uuid, int) from public, anon, authenticated;

-- ───────────────────────── Payments ─────────────────────────
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null,
  provider_session_id text,
  provider_payment_id text,
  status public.payment_status not null default 'pending',
  amount bigint not null check (amount >= 0),
  currency public.currency_code not null,
  refunded_amount bigint not null default 0 check (refunded_amount >= 0 and refunded_amount <= amount),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_payment_id),
  unique (provider, provider_session_id)
);
create index on public.payments (order_id);

-- Webhook deduplication + audit log.
create table public.payment_events (
  id bigint generated always as identity primary key,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  order_id uuid references public.orders(id) on delete set null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

-- ───────────────────────── Fulfillment ─────────────────────────
create table public.supplier_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  idempotency_key text not null unique,
  status public.supplier_order_status not null default 'submitting',
  supplier_order_ref text,
  attempts int not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'submitted' or supplier_order_ref is not null)
);
create index on public.supplier_orders (order_id);
create index on public.supplier_orders (status) where status in ('failed','manual_required');

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  supplier_order_id uuid references public.supplier_orders(id) on delete set null,
  carrier text not null,
  tracking_number text not null,
  tracking_url text,
  status text not null default 'in_transit' check (status in ('label_created','in_transit','out_for_delivery','delivered','exception')),
  shipped_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (carrier, tracking_number)
);
create index on public.shipments (order_id);

create table public.discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  discount_id uuid not null references public.discounts(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz not null default now()
);
create index on public.discount_redemptions (discount_id);

-- ───────────────────────── Virtual store layout ─────────────────────────
create table public.store_sections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  sort_order int not null default 0
);

create table public.store_slots (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.store_sections(id) on delete cascade,
  aisle int not null check (aisle >= 0),
  shelf int not null check (shelf >= 0),
  slot int not null check (slot >= 0),
  product_id uuid references public.products(id) on delete set null,
  facings int not null default 1 check (facings between 1 and 20),
  unique (section_id, aisle, shelf, slot)
);

-- ───────────────────────── Admin audit ─────────────────────────
create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  diff jsonb,
  created_at timestamptz not null default now()
);
create trigger admin_audit_logs_append_only before update or delete on public.admin_audit_logs
  for each row execute function public.prevent_mutation();

-- updated_at triggers
create trigger t_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger t_products_updated before update on public.products for each row execute function public.set_updated_at();
create trigger t_variants_updated before update on public.product_variants for each row execute function public.set_updated_at();
create trigger t_suppliers_updated before update on public.suppliers for each row execute function public.set_updated_at();
create trigger t_carts_updated before update on public.carts for each row execute function public.set_updated_at();
create trigger t_payments_updated before update on public.payments for each row execute function public.set_updated_at();
create trigger t_supplier_orders_updated before update on public.supplier_orders for each row execute function public.set_updated_at();

-- ───────────────────────── Row Level Security ─────────────────────────
do $$ declare t text; begin
  foreach t in array array['profiles','user_roles','categories','products','product_variants','variant_prices',
    'product_images','product_3d_assets','inventory','tax_rates','suppliers','supplier_credentials','supplier_products',
    'addresses','carts','cart_items','discounts','orders','order_items','order_status_events','payments','payment_events',
    'supplier_orders','shipments','discount_redemptions','store_sections','store_slots','admin_audit_logs']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

-- Published catalog is public.
create or replace function public.is_published(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.products where id = p and status = 'published');
$$;
create or replace function public.variant_is_published(v uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.product_variants pv join public.products p on p.id = pv.product_id
                 where pv.id = v and pv.is_active and p.status = 'published');
$$;

create policy "public read categories" on public.categories for select using (true);
create policy "public read published products" on public.products for select using (status = 'published' or public.is_staff());
create policy "public read variants" on public.product_variants for select using ((is_active and public.is_published(product_id)) or public.is_staff());
create policy "public read prices" on public.variant_prices for select using (public.variant_is_published(variant_id) or public.is_staff());
create policy "public read images" on public.product_images for select using (public.is_published(product_id) or public.is_staff());
create policy "public read 3d assets" on public.product_3d_assets for select using (public.is_published(product_id) or public.is_staff());
create policy "public read inventory" on public.inventory for select using (public.variant_is_published(variant_id) or public.is_staff());
create policy "public read store sections" on public.store_sections for select using (true);
create policy "public read store slots" on public.store_slots for select using (true);
create policy "public read tax rates" on public.tax_rates for select using (is_active or public.is_staff());

-- Admin manages catalog, layout, tax, suppliers, discounts.
do $$ declare t text; begin
  foreach t in array array['categories','products','product_variants','variant_prices','product_images','product_3d_assets',
    'inventory','store_sections','store_slots','tax_rates','suppliers','supplier_products','discounts']
  loop execute format('create policy "admin write %1$s" on public.%1$I for all using (public.is_admin()) with check (public.is_admin())', t); end loop;
end $$;

create policy "staff read suppliers" on public.suppliers for select using (public.is_staff());
create policy "staff read supplier products" on public.supplier_products for select using (public.is_staff());
create policy "staff read discounts" on public.discounts for select using (public.is_staff());

-- Profiles & roles
create policy "own profile read" on public.profiles for select using (id = auth.uid() or public.is_staff());
create policy "own profile update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "own roles read" on public.user_roles for select using (user_id = auth.uid() or public.is_admin());

-- Addresses
create policy "own addresses" on public.addresses for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Carts: signed-in users manage their own; guest carts only via server.
create policy "own cart" on public.carts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own cart items" on public.cart_items for all
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid())
              and public.variant_is_published(variant_id));

-- Orders: customers read their own; all writes go through the server.
create policy "own orders read" on public.orders for select using (user_id = auth.uid() or public.is_staff());
create policy "own order items read" on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_staff())));
create policy "own order events read" on public.order_status_events for select
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_staff())));
create policy "own shipments read" on public.shipments for select
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_staff())));
create policy "own payments read" on public.payments for select
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_staff())));

create policy "staff read supplier orders" on public.supplier_orders for select using (public.is_staff());
create policy "staff read payment events" on public.payment_events for select using (public.is_admin());
create policy "admin read audit" on public.admin_audit_logs for select using (public.is_admin());
create policy "staff read redemptions" on public.discount_redemptions for select using (public.is_staff());
-- supplier_credentials: intentionally no policies (server secret key only).

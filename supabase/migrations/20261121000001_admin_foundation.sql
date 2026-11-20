-- Mega Market — Super Admin foundation.
-- Extends the core schema (same products/variants/inventory/orders tables the storefront and 3D store read).
-- Safe/additive: no table drops, no deletion of order or customer data. Money stays bigint minor units.
-- Admin tables have RLS enabled and NO policies: only the server (direct Postgres connection as the table
-- owner) can read/write them. Browser clients (anon/authenticated keys) can never reach them.

-- ───────────────────────── Admin identity (separate from storefront auth) ─────────────────────────
create type public.admin_role as enum ('SUPER_ADMIN','ADMIN','PRODUCT_MANAGER','ORDER_MANAGER','SUPPORT');

create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  full_name text not null default '' check (char_length(full_name) <= 200),
  password_hash text not null,
  role public.admin_role not null,
  extra_permissions text[] not null default '{}',     -- granted on top of the role
  revoked_permissions text[] not null default '{}',   -- removed from the role
  is_active boolean not null default true,
  failed_login_count int not null default 0 check (failed_login_count >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz not null default now(),
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index admin_users_email_ci on public.admin_users (lower(email));

create table public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  token_hash text not null unique,                     -- sha256 of the httpOnly cookie token
  ip text,
  user_agent text check (char_length(user_agent) <= 500),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index on public.admin_sessions (admin_user_id) where revoked_at is null;

-- Append-only activity log: who did what, with before/after snapshots.
create table public.admin_activity_log (
  id bigint generated always as identity primary key,
  admin_user_id uuid references public.admin_users(id) on delete set null,
  admin_email text,                                    -- snapshot, survives user removal
  action text not null,                                -- e.g. product.update, order.transition
  entity text not null,
  entity_id text,
  summary text not null default '',
  before jsonb,
  after jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index on public.admin_activity_log (created_at desc);
create index on public.admin_activity_log (entity, entity_id);
create trigger admin_activity_log_append_only before update or delete on public.admin_activity_log
  for each row execute function public.prevent_mutation();

-- ───────────────────────── Catalog extensions ─────────────────────────
alter table public.categories
  add column description text not null default '',
  add column is_active boolean not null default true,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add constraint categories_not_own_parent check (parent_id is null or parent_id <> id);
create trigger t_categories_updated before update on public.categories for each row execute function public.set_updated_at();

alter table public.products
  add column brand text check (char_length(brand) <= 120),
  add column tags text[] not null default '{}',
  add column seo_title text check (char_length(seo_title) <= 200),
  add column seo_description text check (char_length(seo_description) <= 400),
  add column is_featured boolean not null default false,
  add column deleted_at timestamptz,                   -- soft delete (kept for order history)
  add column archived_at timestamptz;
create index on public.products (status) where deleted_at is null;

alter table public.product_variants
  add column weight_grams int check (weight_grams >= 0),
  add column barcode text check (char_length(barcode) <= 64);

-- 3D shelf mapping: extends the generated placement (features/store3d/layout.ts).
-- face_id = a measured gondola face of the store environment (e.g. 'L1N'); null = automatic by category.
create table public.product_shelf_placements (
  product_id uuid primary key references public.products(id) on delete cascade,
  face_id text check (face_id ~ '^[A-Z0-9]{2,8}$'),
  priority int not null default 0 check (priority between -1000 and 1000),
  hidden_in_store boolean not null default false,      -- still sold in the catalog
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Inventory ─────────────────────────
alter table public.inventory
  add column incoming int not null default 0 check (incoming >= 0),
  add column supplier_reported int check (supplier_reported >= 0),
  add column supplier_reported_at timestamptz,
  add column low_stock_threshold int check (low_stock_threshold >= 0);

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  kind text not null check (kind in ('adjustment','reservation','release','commit','restock','import','incoming','supplier_sync')),
  quantity_before int not null,
  quantity_after int not null,
  reserved_before int not null,
  reserved_after int not null,
  reason text not null default '',
  order_id uuid references public.orders(id) on delete set null,
  admin_user_id uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.inventory_movements (variant_id, created_at desc);
create trigger inventory_movements_append_only before update or delete on public.inventory_movements
  for each row execute function public.prevent_mutation();

-- Per-order reservations make release/commit idempotent (a cancelled order releases exactly once).
create table public.inventory_reservations (
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  quantity int not null check (quantity > 0),
  status text not null default 'reserved' check (status in ('reserved','released','committed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (order_id, variant_id)
);

-- Admin stock change: lock row, set new on-hand quantity (never below reserved), log before/after.
create or replace function public.admin_adjust_inventory(
  p_variant uuid, p_new_quantity int, p_reason text, p_admin uuid, p_kind text default 'adjustment')
returns public.inventory language plpgsql security definer set search_path = public as $$
declare v_old public.inventory; v_new public.inventory;
begin
  if p_new_quantity < 0 then raise exception 'quantity must be >= 0' using errcode = 'check_violation'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = 'check_violation'; end if;
  insert into public.inventory (variant_id, quantity) values (p_variant, 0) on conflict (variant_id) do nothing;
  select * into v_old from public.inventory where variant_id = p_variant for update;
  if p_new_quantity < v_old.reserved then
    raise exception 'cannot set stock to % while % units are reserved by orders', p_new_quantity, v_old.reserved
      using errcode = 'check_violation';
  end if;
  update public.inventory set quantity = p_new_quantity, updated_at = now() where variant_id = p_variant returning * into v_new;
  insert into public.inventory_movements (variant_id, kind, quantity_before, quantity_after, reserved_before, reserved_after, reason, admin_user_id)
  values (p_variant, p_kind, v_old.quantity, v_new.quantity, v_old.reserved, v_new.reserved, p_reason, p_admin);
  return v_new;
end $$;

-- All-or-nothing reservation of an order's lines. Raises (and the caller's transaction rolls back) on any shortfall.
-- p_lines: [{"variant_id": "...", "quantity": 2}, ...]
create or replace function public.reserve_order_inventory(p_order uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_old public.inventory;
begin
  for r in
    select (l->>'variant_id')::uuid as variant_id, sum((l->>'quantity')::int)::int as qty
    from jsonb_array_elements(p_lines) l group by 1 order by 1   -- stable lock order avoids deadlocks
  loop
    if r.qty <= 0 then raise exception 'quantity must be positive'; end if;
    select * into v_old from public.inventory where variant_id = r.variant_id for update;
    if not found or v_old.quantity - v_old.reserved < r.qty then
      raise exception 'insufficient stock for variant %', r.variant_id using errcode = 'check_violation';
    end if;
    update public.inventory set reserved = reserved + r.qty, updated_at = now() where variant_id = r.variant_id;
    insert into public.inventory_reservations (order_id, variant_id, quantity) values (p_order, r.variant_id, r.qty);
    insert into public.inventory_movements (variant_id, kind, quantity_before, quantity_after, reserved_before, reserved_after, reason, order_id)
    values (r.variant_id, 'reservation', v_old.quantity, v_old.quantity, v_old.reserved, v_old.reserved + r.qty, 'Order reservation', p_order);
  end loop;
end $$;

-- Release (failed/cancelled payment) or commit (shipped) an order's open reservations. Idempotent.
create or replace function public.settle_order_inventory(p_order uuid, p_action text, p_admin uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_old public.inventory; n int := 0;
begin
  if p_action not in ('release','commit') then raise exception 'unknown action %', p_action; end if;
  for r in select * from public.inventory_reservations where order_id = p_order and status = 'reserved' order by variant_id for update
  loop
    select * into v_old from public.inventory where variant_id = r.variant_id for update;
    if p_action = 'release' then
      update public.inventory set reserved = greatest(reserved - r.quantity, 0), updated_at = now() where variant_id = r.variant_id;
    else
      update public.inventory set quantity = quantity - r.quantity, reserved = reserved - r.quantity, updated_at = now()
       where variant_id = r.variant_id and reserved >= r.quantity and quantity >= r.quantity;
      if not found then raise exception 'cannot commit % units of %', r.quantity, r.variant_id; end if;
    end if;
    update public.inventory_reservations set status = case p_action when 'release' then 'released' else 'committed' end, updated_at = now()
     where order_id = r.order_id and variant_id = r.variant_id;
    insert into public.inventory_movements (variant_id, kind, quantity_before, quantity_after, reserved_before, reserved_after, reason, order_id, admin_user_id)
    select r.variant_id, p_action, v_old.quantity, i.quantity, v_old.reserved, i.reserved,
           case p_action when 'release' then 'Order reservation released' else 'Order shipped' end, p_order, p_admin
      from public.inventory i where i.variant_id = r.variant_id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.admin_adjust_inventory(uuid, int, text, uuid, text), public.reserve_order_inventory(uuid, jsonb),
  public.settle_order_inventory(uuid, text, uuid) from public, anon, authenticated;

-- ───────────────────────── Suppliers & fulfillment ─────────────────────────
alter table public.suppliers
  add column fulfillment_mode text not null default 'manual' check (fulfillment_mode in ('manual','api')),
  add column website text,
  add column notes text not null default '',
  add column default_currency public.currency_code not null default 'EUR',
  add column lead_time_days int check (lead_time_days >= 0);

alter table public.supplier_orders
  add column fulfillment_mode text not null default 'manual' check (fulfillment_mode in ('manual','api')),
  add column cost_total bigint check (cost_total >= 0),
  add column cost_currency public.currency_code,
  add column notes text not null default '';

-- Which order lines a supplier order covers (an order is split into one supplier order per supplier).
create table public.supplier_order_items (
  id uuid primary key default gen_random_uuid(),
  supplier_order_id uuid not null references public.supplier_orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  supplier_sku text not null,
  quantity int not null check (quantity > 0),
  unit_cost bigint check (unit_cost >= 0),
  cost_currency public.currency_code,
  unique (supplier_order_id, order_item_id)
);

-- ───────────────────────── Orders: snapshots, notes, refunds, invoices ─────────────────────────
alter table public.orders
  add column base_currency public.currency_code,       -- store base currency at purchase time
  add column fx_rate_to_base numeric(18,8) check (fx_rate_to_base > 0), -- snapshot; never rewritten
  add column shipping_method_name text,
  add column customer_note text check (char_length(customer_note) <= 2000),
  add column is_test boolean not null default false;   -- created by tests/dev tools or a sandbox payment provider

create table public.order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  admin_user_id uuid references public.admin_users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 5000),
  is_customer_visible boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.order_notes (order_id, created_at);

alter table public.payments
  add column fee_amount bigint check (fee_amount >= 0),   -- provider fee, when the provider reports it
  add column is_test boolean not null default true;

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  amount bigint not null check (amount > 0),
  currency public.currency_code not null,
  reason text not null check (char_length(reason) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending','succeeded','failed','manual')),
  provider text,
  provider_refund_id text,
  idempotency_key text not null unique,
  error text,
  admin_user_id uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.refunds (order_id);
create trigger t_refunds_updated before update on public.refunds for each row execute function public.set_updated_at();

create sequence public.invoice_number_seq start 1;
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  invoice_number text not null unique,
  issued_at timestamptz not null default now(),
  seller_snapshot jsonb not null                       -- seller details from settings at issue time
);
create trigger invoices_immutable before update or delete on public.invoices for each row execute function public.prevent_mutation();

alter table public.shipments
  add column shipping_method_name text,
  add column created_by uuid references public.admin_users(id) on delete set null,
  add column notes text not null default '';

-- ───────────────────────── Shipping ─────────────────────────
create table public.shipping_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  countries text[] not null check (cardinality(countries) > 0),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.shipping_methods (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.shipping_zones(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  carrier text,
  rate_type text not null check (rate_type in ('fixed','weight','order_value')),
  currency public.currency_code not null,
  fixed_amount bigint check (fixed_amount >= 0),
  free_over_amount bigint check (free_over_amount >= 0),  -- free shipping when goods subtotal >= this
  min_days int check (min_days >= 0),
  max_days int check (max_days >= min_days),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  check (rate_type <> 'fixed' or fixed_amount is not null)
);
create index on public.shipping_methods (zone_id);

-- Tiered rates: weight in grams or order value in minor units; [min_value, max_value) with null = open-ended.
create table public.shipping_rates (
  id uuid primary key default gen_random_uuid(),
  method_id uuid not null references public.shipping_methods(id) on delete cascade,
  min_value bigint not null default 0 check (min_value >= 0),
  max_value bigint check (max_value > min_value),
  amount bigint not null check (amount >= 0)
);
create index on public.shipping_rates (method_id);

-- ───────────────────────── Currency & finance ─────────────────────────
create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency public.currency_code not null,
  quote_currency public.currency_code not null,
  rate numeric(18,8) not null check (rate > 0),          -- 1 base = rate quote
  source text not null default 'manual',
  effective_at timestamptz not null default now(),
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (base_currency <> quote_currency)
);
create index on public.exchange_rates (base_currency, quote_currency, effective_at desc);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('advertising','software','shipping_supplies','fees','salaries','other')),
  description text not null check (char_length(description) between 1 and 500),
  amount bigint not null check (amount > 0),
  currency public.currency_code not null,
  incurred_on date not null,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.expenses (incurred_on);

-- ───────────────────────── Discounts (coupons) ─────────────────────────
alter table public.discounts
  add column name text not null default '',
  add column per_customer_limit int check (per_customer_limit > 0),
  add column applies_to text not null default 'all' check (applies_to in ('all','category','product')),
  add column target_ids uuid[] not null default '{}',
  add column created_by uuid references public.admin_users(id) on delete set null;

-- ───────────────────────── Reviews ─────────────────────────
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  author_name text not null check (char_length(author_name) between 1 and 80),
  rating int not null check (rating between 1 and 5),
  title text not null default '' check (char_length(title) <= 160),
  body text not null default '' check (char_length(body) <= 5000),
  status text not null default 'pending' check (status in ('pending','approved','rejected','hidden')),
  -- Set by the server only when order_id is a delivered order that contains this product.
  is_verified_purchase boolean not null default false,
  moderated_by uuid references public.admin_users(id) on delete set null,
  moderated_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.reviews (product_id) where status = 'approved';
create index on public.reviews (status, created_at desc);

-- ───────────────────────── Settings & content ─────────────────────────
create table public.store_settings (
  key text primary key check (key ~ '^[a-z0-9_.]+$'),
  value jsonb not null,
  updated_by uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.cms_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title text not null check (char_length(title) between 1 and 200),
  draft_body text not null default '',
  published_body text,                                  -- null = never published
  status text not null default 'draft' check (status in ('draft','published','unpublished')),
  published_at timestamptz,
  updated_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger t_cms_pages_updated before update on public.cms_pages for each row execute function public.set_updated_at();

-- ───────────────────────── Notifications & email ─────────────────────────
create table public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                                   -- low_stock, new_order, supplier_failed, refund_failed, ...
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  title text not null,
  body text not null default '',
  link text,
  dedupe_key text unique,                               -- prevents duplicate alerts (e.g. low_stock:<variant>)
  created_at timestamptz not null default now()
);
create index on public.admin_notifications (created_at desc);
create table public.admin_notification_reads (
  notification_id uuid not null references public.admin_notifications(id) on delete cascade,
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, admin_user_id)
);

-- Outgoing email log. status 'not_configured' = no provider credentials: nothing was sent (never simulated).
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_address text not null,
  subject text not null,
  body_text text not null,
  template text,
  status text not null default 'queued' check (status in ('queued','sent','failed','not_configured')),
  provider text,
  provider_message_id text,
  error text,
  related_order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- ───────────────────────── RLS ─────────────────────────
do $$ declare t text; begin
  foreach t in array array['admin_users','admin_sessions','admin_activity_log','product_shelf_placements','inventory_movements',
    'inventory_reservations','supplier_order_items','order_notes','refunds','invoices','shipping_zones','shipping_methods',
    'shipping_rates','exchange_rates','expenses','reviews','store_settings','cms_pages','admin_notifications',
    'admin_notification_reads','email_outbox']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

-- Storefront-visible data (read-only, public).
create policy "public read shelf placements" on public.product_shelf_placements for select using (public.is_published(product_id));
create policy "public read shipping zones" on public.shipping_zones for select using (is_active);
create policy "public read shipping methods" on public.shipping_methods for select using (is_active);
create policy "public read shipping rates" on public.shipping_rates for select using (true);
create policy "public read approved reviews" on public.reviews for select using (status = 'approved' or user_id = auth.uid());
create policy "public read published pages" on public.cms_pages for select using (status = 'published');
create policy "public read storefront settings" on public.store_settings for select using (key like 'storefront.%');
create policy "own customer-visible notes" on public.order_notes for select
  using (is_customer_visible and exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));
-- Everything else (admin_*, inventory_movements, refunds, invoices, expenses, email_outbox, exchange_rates): no policies → server only.

-- ───────────────────────── Defaults (business configuration, editable in admin) ─────────────────────────
insert into public.store_settings (key, value) values
  ('store.base_currency', '"EUR"'),
  ('store.default_low_stock_threshold', '5'),
  ('store.name', '"Mega Market"'),
  ('store.support_email', 'null'),
  -- Seller details printed on invoices. Empty until the owner fills them in (no invented legal data).
  ('store.seller', '{"legalName": "", "address": "", "vatNumber": "", "email": ""}'),
  ('store.stock_all_faces', 'false'),
  ('storefront.home', '{"heroEyebrow": "", "heroTitle": "", "heroSubtitle": "", "announcement": ""}')
on conflict (key) do nothing;

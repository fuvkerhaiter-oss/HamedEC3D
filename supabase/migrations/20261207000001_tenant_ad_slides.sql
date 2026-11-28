-- Ad slides shown on the big wall-mounted TVs inside each rental shop in the 3D store.
-- Managed by the shop owner in /seller/shop (up to 8 images per tenant).

create table if not exists public.tenant_ad_slides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant_accounts(id) on delete cascade,
  image_bucket text not null,
  image_path text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists tenant_ad_slides_tenant_sort_idx
  on public.tenant_ad_slides (tenant_id, sort, created_at);

alter table public.tenant_ad_slides enable row level security;

create policy "tenant_ad_slides public read"
  on public.tenant_ad_slides for select
  using (true);

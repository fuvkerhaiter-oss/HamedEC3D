-- Product image management (Super Admin). Additive.
-- Binaries live in Supabase Storage (bucket `products`, path {product_id}/{unique}.webp); PostgreSQL keeps only
-- the reference + metadata in the existing `product_images` table, which the catalog and the 3D store already read.

alter table public.product_images
  add column bucket text not null default 'product-images' check (bucket ~ '^[a-z0-9-]{3,63}$'),
  add column is_primary boolean not null default false,
  add column width int check (width > 0),
  add column height int check (height > 0),
  add column bytes bigint check (bytes > 0),
  add column mime_type text check (mime_type in ('image/webp','image/jpeg','image/png','image/avif')),
  add column created_at timestamptz not null default now(),
  add column created_by uuid references public.admin_users(id) on delete set null;

-- Exactly one main image per product (when it has images).
with first as (
  select distinct on (product_id) id from public.product_images order by product_id, sort_order, id
)
update public.product_images set is_primary = true where id in (select id from first);
create unique index product_images_one_primary on public.product_images (product_id) where is_primary;
create index product_images_object on public.product_images (bucket, storage_path);

-- Public bucket for product photos. Reads are public (CDN); there are deliberately NO insert/update/delete
-- policies: only the server (Supabase secret key, which bypasses RLS) can write, after the admin
-- permission check in the app. The browser never receives a write-capable key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('products', 'products', true, 10485760, array['image/webp','image/jpeg','image/png','image/avif'])
on conflict (id) do nothing;

drop policy if exists "public read product media" on storage.objects;
create policy "public read product media" on storage.objects for select
  using (bucket_id in ('product-images','product-models','products'));

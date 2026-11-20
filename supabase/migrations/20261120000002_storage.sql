-- Storage buckets for product media. Public read (served via CDN), admin-only writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-images', 'product-images', true, 5242880,  array['image/jpeg','image/png','image/webp','image/avif']),
  ('product-models', 'product-models', true, 52428800, array['model/gltf-binary','application/octet-stream'])
on conflict (id) do nothing;

create policy "public read product media" on storage.objects for select
  using (bucket_id in ('product-images','product-models'));
create policy "admin upload product media" on storage.objects for insert
  with check (bucket_id in ('product-images','product-models') and public.is_admin());
create policy "admin update product media" on storage.objects for update
  using (bucket_id in ('product-images','product-models') and public.is_admin());
create policy "admin delete product media" on storage.objects for delete
  using (bucket_id in ('product-images','product-models') and public.is_admin());

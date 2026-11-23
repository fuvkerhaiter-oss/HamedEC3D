-- Customer Authentication Enhancements
-- 1. Populate profile metadata (full_name) on user creation from OAuth or user metadata
-- 2. Automatically link existing guest orders with verified matching email to new user account
-- 3. Allow customers to read orders matching their user_id or verified auth email

create or replace function public.auth_email() returns text language sql stable security definer set search_path = public as $$
  select nullif(lower(coalesce(auth.jwt()->>'email', current_setting('request.jwt.claim.email', true))), '');
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  v_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    nullif(trim(concat_ws(' ', new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name')), '')
  );

  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, v_name)
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      updated_at = now();

  -- Associate prior guest orders placed with this verified email
  if new.email is not null and new.email <> '' then
    update public.orders
    set user_id = new.id
    where lower(email) = lower(new.email) and user_id is null;
  end if;

  return new;
end $$;

-- Policy enhancements: customers read orders either by user_id OR matching verified auth token email
drop policy if exists "own orders read" on public.orders;
create policy "own orders read" on public.orders for select
  using (user_id = auth.uid() or (auth.uid() is not null and email is not null and lower(email) = public.auth_email()) or public.is_staff());

drop policy if exists "own order items read" on public.order_items;
create policy "own order items read" on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or (auth.uid() is not null and o.email is not null and lower(o.email) = public.auth_email()) or public.is_staff())));

drop policy if exists "own order events read" on public.order_status_events;
create policy "own order events read" on public.order_status_events for select
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or (auth.uid() is not null and o.email is not null and lower(o.email) = public.auth_email()) or public.is_staff())));

drop policy if exists "own shipments read" on public.shipments;
create policy "own shipments read" on public.shipments for select
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or (auth.uid() is not null and o.email is not null and lower(o.email) = public.auth_email()) or public.is_staff())));

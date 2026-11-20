-- Database security & integrity tests. Runs in a transaction and rolls back.
-- Local: psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_and_constraints.sql  (prints "ALL DB TESTS PASSED")
begin;

create or replace function pg_temp.expect_error(sql text, label text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then return; end;
  raise exception 'EXPECTED FAILURE did not fail: %', label;
end $$;
create or replace function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'ASSERTION FAILED: %', label; end if; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- Fixtures (as owner)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@example.com');
insert into public.user_roles values ('00000000-0000-0000-0000-0000000000ad', 'admin', now());
insert into public.products (slug, name, status) values ('secret-draft', 'Unreleased', 'draft');
insert into public.supplier_products (supplier_id, variant_id, supplier_sku, cost_amount, cost_currency)
  select s.id, v.id, 'SUP-1', 400, 'EUR' from public.suppliers s, public.product_variants v where v.sku = 'MOCK-PASTA-PENNE-1' limit 1;
insert into public.orders (id, user_id, email, currency, tax_mode, subtotal, total, shipping_address, ship_country)
  values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a', 'alice@example.com', 'EUR', 'inclusive', 1000, 1000, '{}', 'IT');
insert into public.order_items (order_id, product_name, variant_name, sku, unit_price, quantity, line_total)
  values ('11111111-1111-1111-1111-111111111111', 'Penne', '500 g', 'MOCK-PASTA-PENNE-1', 500, 2, 1000);

-- ── Constraints ──
select pg_temp.expect_error($$insert into public.variant_prices select id, 'EUR', -1 from public.product_variants limit 1$$, 'negative price');
select pg_temp.expect_error($$insert into public.variant_prices select id, 'GBP', 100 from public.product_variants limit 1$$, 'unsupported currency');
select pg_temp.expect_error($$insert into public.orders (user_id,email,currency,tax_mode,subtotal,total,shipping_address,ship_country) values (null,'x@y.z','EUR','exclusive',1000,1,'{}','IT')$$, 'order total mismatch');
select pg_temp.expect_error($$insert into public.order_items (order_id,product_name,variant_name,sku,unit_price,quantity,line_total) values ('11111111-1111-1111-1111-111111111111','a','b','c',100,2,150)$$, 'line total mismatch');
select pg_temp.expect_error($$update public.order_items set unit_price = 1$$, 'order items immutable');
select pg_temp.expect_error($$update public.orders set total = 1, subtotal = 1 where id = '11111111-1111-1111-1111-111111111111'$$, 'order amounts immutable');
select pg_temp.expect_error($$update public.orders set status = 'shipped' where id = '11111111-1111-1111-1111-111111111111'$$, 'invalid transition pending->shipped');
select pg_temp.expect_error($$update public.inventory set reserved = quantity + 1$$, 'reserved > quantity');

-- Transition with audit
select public.transition_order('11111111-1111-1111-1111-111111111111', 'paid', 'payment_webhook', 'stripe', null, '{"verifiedPaymentId":"pi_1"}');
select pg_temp.expect((select count(*) = 1 from public.order_status_events where order_id = '11111111-1111-1111-1111-111111111111'), 'audit row written');
select pg_temp.expect_error($$delete from public.order_status_events$$, 'audit append-only');

-- Inventory reservation: orange juice has 4
select pg_temp.expect(public.reserve_inventory((select id from public.product_variants where sku='MOCK-ORANGE-JUICE-1'), 3), 'reserve 3 of 4');
select pg_temp.expect(not public.reserve_inventory((select id from public.product_variants where sku='MOCK-ORANGE-JUICE-1'), 2), 'cannot oversell');

-- Duplicate webhook / supplier order protection
insert into public.payment_events (provider, provider_event_id, event_type, payload) values ('stripe','evt_1','x','{}');
select pg_temp.expect_error($$insert into public.payment_events (provider, provider_event_id, event_type, payload) values ('stripe','evt_1','x','{}')$$, 'duplicate webhook event');
insert into public.supplier_orders (order_id, supplier_id, idempotency_key) select '11111111-1111-1111-1111-111111111111', id, 'k1' from public.suppliers limit 1;
select pg_temp.expect_error($$insert into public.supplier_orders (order_id, supplier_id, idempotency_key) select '11111111-1111-1111-1111-111111111111', id, 'k1' from public.suppliers limit 1$$, 'duplicate supplier order');

-- ── RLS: anonymous visitor ──
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect((select count(*) = 10 from public.products), 'anon sees only published products');
select pg_temp.expect((select count(*) = 0 from public.products where slug = 'secret-draft'), 'anon cannot see drafts');
select pg_temp.expect((select count(*) = 24 from public.variant_prices), 'anon sees prices');
select pg_temp.expect((select count(*) = 0 from public.supplier_products), 'anon cannot see supplier costs');
select pg_temp.expect((select count(*) = 0 from public.suppliers), 'anon cannot see suppliers');
select pg_temp.expect((select count(*) = 0 from public.orders), 'anon cannot see orders');
select pg_temp.expect((select count(*) = 0 from public.payment_events), 'anon cannot see payment events');
select pg_temp.expect_error($$insert into public.products (slug, name) values ('hack', 'x')$$, 'anon cannot create products');
reset role;

-- ── RLS: customer Alice ──
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select pg_temp.expect((select count(*) = 1 from public.orders), 'alice sees her order');
select pg_temp.expect((select count(*) = 1 from public.order_items), 'alice sees her order items');
select pg_temp.expect((select count(*) = 0 from public.supplier_products), 'customer cannot see supplier costs');
select pg_temp.expect((select count(*) = 0 from public.supplier_credentials), 'customer cannot see credentials');
select pg_temp.expect(not public.is_admin(), 'alice not admin');
-- Updates by a customer silently affect 0 rows under RLS; verify nothing changed afterwards.
update public.variant_prices set amount = 1;
update public.orders set status = 'cancelled';
select pg_temp.expect_error($$insert into public.user_roles values ('00000000-0000-0000-0000-00000000000a','admin',now())$$, 'cannot self-grant admin');
select pg_temp.expect_error($$insert into public.orders (user_id,email,currency,tax_mode,subtotal,total,shipping_address,ship_country) values ('00000000-0000-0000-0000-00000000000a','a@b.c','EUR','inclusive',0,0,'{}','IT')$$, 'customer cannot insert orders');
select pg_temp.expect_error($$select public.transition_order('11111111-1111-1111-1111-111111111111','refund_requested','customer',null,null,null)$$, 'customer cannot call transition_order');
select pg_temp.expect_error($$select public.reserve_inventory((select id from public.product_variants limit 1), 1)$$, 'customer cannot reserve inventory');
insert into public.carts (user_id, currency) values ('00000000-0000-0000-0000-00000000000a', 'EUR');
insert into public.cart_items select c.id, v.id, 2 from public.carts c, public.product_variants v where v.sku = 'MOCK-PASTA-PENNE-1';
select pg_temp.expect_error($$update public.cart_items set quantity = 100$$, 'cart qty > 99');
select pg_temp.expect((select quantity = 2 from public.cart_items), 'alice manages own cart');
select pg_temp.expect_error($$insert into public.carts (user_id, currency) values ('00000000-0000-0000-0000-00000000000b','EUR')$$, 'cannot create cart for another user');
insert into public.addresses (user_id, full_name, line1, city, postal_code, country) values ('00000000-0000-0000-0000-00000000000a','Alice','Via Roma 1','Milano','20100','IT');
reset role;
select pg_temp.expect((select min(amount) > 1 from public.variant_prices), 'customer price update had no effect');
select pg_temp.expect((select status = 'paid' from public.orders where id = '11111111-1111-1111-1111-111111111111'), 'customer status update had no effect');

-- ── RLS: customer Bob cannot see Alice's data ──
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select pg_temp.expect((select count(*) = 0 from public.orders), 'bob cannot see alice order');
select pg_temp.expect((select count(*) = 0 from public.addresses), 'bob cannot see alice address');
select pg_temp.expect((select count(*) = 0 from public.cart_items), 'bob cannot see alice cart');
reset role;

-- ── RLS: admin ──
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ad', true);
select pg_temp.expect(public.is_admin(), 'admin recognized');
select pg_temp.expect((select count(*) = 11 from public.products), 'admin sees drafts');
select pg_temp.expect((select count(*) = 1 from public.supplier_products), 'admin sees supplier costs');
select pg_temp.expect((select count(*) = 0 from public.supplier_credentials), 'even admin cannot read credentials from client');
update public.products set name = 'Unreleased v2' where slug = 'secret-draft';
select pg_temp.expect((select name = 'Unreleased v2' from public.products where slug = 'secret-draft'), 'admin can edit products');
reset role;

select 'ALL DB TESTS PASSED' as result;
rollback;

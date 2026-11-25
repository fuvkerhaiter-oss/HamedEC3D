-- Dashboard reads: the admin home page filters orders by date and by "real, not test" on every load.
-- Without a created_at index these aggregates full-scan the orders table; the recent-orders card also sorts it.
create index if not exists orders_created_at_desc_idx on public.orders (created_at desc);
create index if not exists orders_real_created_at_idx on public.orders (is_test, created_at desc);

-- "New customers" groups every real paid order by email and takes the first order date. This partial
-- index makes that scan index-only instead of reading the whole orders table and sorting it.
create index if not exists orders_customer_first_paid_idx
  on public.orders (lower(email), created_at)
  where not is_test and status in ('paid','processing','submitted_to_supplier','supplier_accepted','shipped','delivered');

-- Refund totals on the dashboard are constrained to a date window.
create index if not exists refunds_created_at_idx on public.refunds (created_at desc);

-- The alerts badge counts unread rows per admin; the primary key starts with notification_id,
-- so this index serves the per-admin side of the NOT EXISTS check.
create index if not exists admin_notification_reads_admin_idx on public.admin_notification_reads (admin_user_id);

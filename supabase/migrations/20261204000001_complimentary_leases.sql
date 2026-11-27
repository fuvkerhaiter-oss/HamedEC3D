-- Complimentary (free) shop rentals given by a super admin from /admin/rentals (lib/rentals/service.ts,
-- grantComplimentaryLease). Such a lease has amount = 0 and provider = 'complimentary': no Stripe session, no webhook.
-- Paid leases keep the old rule (amount > 0). No new column, no existing data is modified.
--
-- Rollback (manual, if ever needed; first cancel or delete every complimentary lease):
--   alter table public.shop_leases drop constraint shop_leases_amount_check;
--   alter table public.shop_leases add constraint shop_leases_amount_check check (amount > 0);

alter table public.shop_leases drop constraint shop_leases_amount_check;
alter table public.shop_leases add constraint shop_leases_amount_check
  check (amount > 0 or (amount = 0 and provider = 'complimentary' and provider_payment_id is null));

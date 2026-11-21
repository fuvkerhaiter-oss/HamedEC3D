-- Phase 1 security hardening: payment-gated fulfillment, Stripe financial records, refund uniqueness.
-- Additive only (new columns, functions, triggers, partial unique indexes). No data is modified or deleted.
--
-- Rollback (manual, if ever needed):
--   drop trigger if exists orders_fulfillment_gate on public.orders;
--   drop trigger if exists supplier_orders_fulfillment_gate on public.supplier_orders;
--   drop function if exists public.guard_order_fulfillment(); drop function if exists public.guard_supplier_order_fulfillment();
--   drop function if exists public.order_has_verified_payment(uuid);
--   drop index if exists public.refunds_provider_refund_unique; drop index if exists public.payments_balance_tx_unique;
--   alter table public.payments drop column if exists balance_transaction_id, drop column if exists gross_amount,
--     drop column if exists net_amount, drop column if exists settlement_currency, drop column if exists financials_synced_at;

-- ───────────────────────── Fulfillment eligibility (defence in depth) ─────────────────────────
-- An order is fulfillable only with a provider-confirmed payment for exactly the order total, recorded by
-- the verified payment webhook (status event to 'paid' by actor payment_webhook). Fully refunded payments
-- do not count. The application checks the same rule first (lib/orders/fulfillment-eligibility.ts) and
-- re-verifies with the provider; this trigger makes it impossible to bypass from any code path.
create or replace function public.order_has_verified_payment(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o
      join public.payments p on p.order_id = o.id
     where o.id = p_order
       and p.status in ('succeeded', 'partially_refunded')
       and p.provider_payment_id is not null
       and p.amount = o.total and p.currency = o.currency
       and p.refunded_amount < p.amount
  ) and exists (
    select 1 from public.order_status_events e
     where e.order_id = p_order and e.to_status = 'paid' and e.actor_type = 'payment_webhook'
  );
$$;
revoke execute on function public.order_has_verified_payment(uuid) from public, anon, authenticated;

create or replace function public.guard_order_fulfillment() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status
     and new.status in ('processing', 'submitted_to_supplier', 'supplier_accepted', 'shipped')
     and not public.order_has_verified_payment(new.id) then
    raise exception 'Order % has no verified successful payment and cannot be fulfilled', new.order_number using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger orders_fulfillment_gate before update of status on public.orders
  for each row execute function public.guard_order_fulfillment();

-- Supplier orders can only be created / marked submitted while the order is in fulfillment with a verified payment.
create or replace function public.guard_supplier_order_fulfillment() returns trigger language plpgsql as $$
declare v_status public.order_status;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if tg_op = 'INSERT' or new.status = 'submitted' then
    select status into v_status from public.orders where id = new.order_id for share; -- serialise with status changes
    if v_status is null or v_status not in ('processing', 'submitted_to_supplier', 'failed')
       or not public.order_has_verified_payment(new.order_id) then
      raise exception 'Supplier fulfillment refused: order is % without a verified successful payment', coalesce(v_status::text, 'missing')
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger supplier_orders_fulfillment_gate before insert or update of status on public.supplier_orders
  for each row execute function public.guard_supplier_order_fulfillment();

-- ───────────────────────── Stripe financial records ─────────────────────────
-- Actual amounts from the provider's balance transaction (settlement currency may differ from the order
-- currency). `fee_amount` (existing column) is set only when the settlement currency equals the payment currency.
alter table public.payments
  add column if not exists balance_transaction_id text,
  add column if not exists gross_amount bigint check (gross_amount >= 0),
  add column if not exists net_amount bigint,
  add column if not exists settlement_currency text check (settlement_currency ~ '^[A-Z]{3}$'),
  add column if not exists financials_synced_at timestamptz;
create unique index if not exists payments_balance_tx_unique on public.payments (provider, balance_transaction_id)
  where balance_transaction_id is not null;

-- ───────────────────────── Refund integrity ─────────────────────────
-- One local record per provider refund (prevents double-counting a refund).
create unique index if not exists refunds_provider_refund_unique on public.refunds (provider, provider_refund_id)
  where provider_refund_id is not null;
create index if not exists refunds_payment_idx on public.refunds (payment_id);

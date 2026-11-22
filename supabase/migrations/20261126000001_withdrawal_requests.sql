-- Online withdrawal function (EU Consumer Rights Directive art. 11a, added by Directive (EU) 2023/2673,
-- applicable from 19 June 2026): consumers can withdraw from a distance contract with a "withdraw from
-- contract" button and get an acknowledgement on a durable medium. Each submitted statement is kept here as
-- evidence (what, who, when) together with the items it covers.
-- Additive only: two new tables. No existing data is modified.
--
-- Rollback (manual, if ever needed):
--   drop table if exists public.withdrawal_request_items, public.withdrawal_requests;

create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 200),
  -- Where the acknowledgement was sent (the consumer may give a different address than the order's).
  confirmation_email text not null check (char_length(confirmation_email) between 3 and 254),
  reason text check (reason is null or char_length(reason) <= 1000),      -- optional, never required
  whole_order boolean not null,
  -- received = waiting for the team; completed = goods back / refunded; rejected = not valid (e.g. late), with note.
  status text not null default 'received' check (status in ('received', 'completed', 'rejected')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 2000),
  handled_by uuid references public.admin_users(id) on delete set null,
  handled_at timestamptz,
  submitted_at timestamptz not null default now()
);
create index on public.withdrawal_requests (order_id, submitted_at desc);
create index withdrawal_requests_open on public.withdrawal_requests (submitted_at) where status = 'received';

create table public.withdrawal_request_items (
  request_id uuid not null references public.withdrawal_requests(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  quantity int not null check (quantity between 1 and 99),
  primary key (request_id, order_item_id)
);

-- Server-only (the app talks to Postgres directly); no public access through the Supabase API.
alter table public.withdrawal_requests enable row level security;
alter table public.withdrawal_request_items enable row level security;

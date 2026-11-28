-- Security hardening (2026-11-28). Additive only: one new table, new nullable/defaulted columns. No data changes.
--
-- 1. rate_limit_buckets: fixed-window counters shared by every server instance (the in-memory limiter was per
--    serverless instance). Keys are sha256 hashes, so no IP or email is stored. Rows older than a day are deleted
--    by the daily maintenance cron.
-- 2. Admin TOTP two-factor authentication: encrypted secret, enrolment time, last accepted time step (replay
--    protection) and single-use recovery codes (sha256 hashes only). Existing admins are unaffected until they
--    enrol; ADMIN_REQUIRE_MFA can later require it for super admins (they are sent to enrolment, never locked out).
--
-- Rollback (manual, if ever needed):
--   drop table if exists public.rate_limit_buckets;
--   alter table public.admin_users drop column if exists totp_secret_enc, drop column if exists totp_enabled_at,
--     drop column if exists totp_last_step, drop column if exists totp_recovery_hashes;

create table public.rate_limit_buckets (
  key_hash text not null check (char_length(key_hash) = 64),
  window_start timestamptz not null,
  hits int not null default 1 check (hits >= 0),
  primary key (key_hash, window_start)
);
create index rate_limit_buckets_window on public.rate_limit_buckets (window_start);

alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from anon, authenticated;

alter table public.admin_users
  add column totp_secret_enc text check (totp_secret_enc is null or char_length(totp_secret_enc) <= 400),
  add column totp_enabled_at timestamptz,
  add column totp_last_step bigint,
  add column totp_recovery_hashes text[] not null default '{}';
-- A pending (not yet confirmed) secret may exist without totp_enabled_at; an enabled one always has a secret.
alter table public.admin_users
  add constraint admin_users_totp_consistent check (totp_enabled_at is null or totp_secret_enc is not null);

-- 3. CMS drafts: the public policy lets the browser roles read PUBLISHED pages, but with Supabase's default
--    table grants that included every column, so unpublished edits (draft_body) were readable with the public key.
--    The site reads pages over the server's direct connection; browsers only ever need the published columns.
revoke select on public.cms_pages from anon, authenticated;
grant select (id, slug, title, published_body, status, published_at, updated_at) on public.cms_pages to anon, authenticated;

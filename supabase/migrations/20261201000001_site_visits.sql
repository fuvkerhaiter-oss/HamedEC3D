-- Visitor log for the super-admin dashboard (Admin → Change history → Visitors).
-- One row per visit (a visit = same IP + browser, ended after 30 minutes without activity), plus the pages
-- seen during it. Written only by the server (/api/visit). No cookies: a visit is matched server-side.
-- Country / region / city come from the hosting platform's geo headers (Vercel / Cloudflare), never from
-- a third-party lookup. Rows older than the retention (lib/visitors/service.ts, 90 days) are deleted by the daily cron.
-- Additive only: two new tables. No existing data is modified.
--
-- Rollback (manual, if ever needed):
--   drop table if exists public.site_visit_pages; drop table if exists public.site_visits;

create table public.site_visits (
  id uuid primary key default gen_random_uuid(),
  ip text not null check (char_length(ip) <= 64),
  -- sha256(ip + user agent): groups visits of the same browser (returning visitor) without storing more.
  visitor_key text not null check (char_length(visitor_key) = 64),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  region text check (region is null or char_length(region) <= 80),
  city text check (city is null or char_length(city) <= 80),
  timezone text check (timezone is null or char_length(timezone) <= 64),
  device text not null check (device in ('desktop', 'mobile', 'tablet', 'bot', 'unknown')),
  os text check (os is null or char_length(os) <= 40),
  browser text check (browser is null or char_length(browser) <= 40),
  is_bot boolean not null default false,
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  language text check (language is null or char_length(language) <= 20),
  screen text check (screen is null or char_length(screen) <= 20),
  landing_path text not null check (char_length(landing_path) <= 300),
  last_path text not null check (char_length(last_path) <= 300),
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 200),
  page_views int not null default 1 check (page_views >= 0),
  is_returning boolean not null default false,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  check (last_seen_at >= started_at)
);

create index site_visits_started on public.site_visits (started_at desc);
create index site_visits_match on public.site_visits (visitor_key, last_seen_at desc);
create index site_visits_live on public.site_visits (last_seen_at desc);
create index site_visits_country on public.site_visits (country, started_at desc);
create index site_visits_ip on public.site_visits (ip);

create table public.site_visit_pages (
  id bigint generated always as identity primary key,
  visit_id uuid not null references public.site_visits(id) on delete cascade,
  path text not null check (char_length(path) <= 300),
  viewed_at timestamptz not null default now()
);

create index site_visit_pages_visit on public.site_visit_pages (visit_id, viewed_at);

-- Server-only (the app talks to Postgres directly); no public access through the Supabase API.
alter table public.site_visits enable row level security;
alter table public.site_visit_pages enable row level security;
revoke all on public.site_visits from anon, authenticated;
revoke all on public.site_visit_pages from anon, authenticated;

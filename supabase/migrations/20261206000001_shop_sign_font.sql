-- Typeface of a tenant's 3D shop sign (choices: src/lib/rentals/sign-fonts.ts, validated by the app; the database only
-- checks the id's shape so new fonts need no migration). Edited by the tenant in /seller/shop.
-- Additive only: one new column with a default. No existing data is modified.
--
-- Rollback (manual, if ever needed):
--   alter table public.tenant_accounts drop column if exists sign_font;

alter table public.tenant_accounts
  add column sign_font text not null default 'bricolage' check (sign_font ~ '^[a-z0-9-]{2,32}$');

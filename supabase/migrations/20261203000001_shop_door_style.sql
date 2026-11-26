-- Door front look of a tenant's rental shop in the 3D store (lib/rentals/door-style.ts): frame colour and neon
-- lighting (colour, effect, brightness). Edited by the tenant (/seller/shop) or an admin (/admin/rentals/tenants/:id).
-- Additive only: four new columns with defaults. No existing data is modified.
--
-- Rollback (manual, if ever needed):
--   alter table public.tenant_accounts drop column if exists door_color, drop column if exists door_light_color,
--     drop column if exists door_light_effect, drop column if exists door_light_level;

alter table public.tenant_accounts
  add column door_color text not null default '#23272b' check (door_color ~ '^#[0-9a-f]{6}$'),
  add column door_light_color text not null default '#f7c416' check (door_light_color ~ '^#[0-9a-f]{6}$'),
  add column door_light_effect text not null default 'breathe' check (door_light_effect in ('steady', 'breathe', 'chase', 'rainbow', 'off')),
  add column door_light_level int not null default 75 check (door_light_level between 0 and 100);

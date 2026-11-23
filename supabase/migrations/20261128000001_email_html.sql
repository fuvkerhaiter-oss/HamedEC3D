-- Store the rendered HTML body alongside the plain text.
-- Older rows have no body_html; the sender falls back to textToHtml() for them.
alter table public.email_outbox add column if not exists body_html text;

comment on column public.email_outbox.body_html is
  'Rendered WEGO SHIIIP HTML for this message. Null on legacy rows; the outbox sender falls back to textToHtml().';

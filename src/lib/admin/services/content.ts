/** CMS pages (draft → publish), and the provider-independent email service. */
import type { Db } from "../../db/client";
import { logActivity, type Actor } from "../audit";
import { slugify } from "./products";

export async function listPages(db: Db) {
  return db<{ id: string; slug: string; title: string; status: string; published_at: Date | null; updated_at: Date; has_unpublished_changes: boolean }[]>`
    select id, slug, title, status, published_at, updated_at, (published_body is distinct from draft_body) as has_unpublished_changes
      from public.cms_pages order by title`;
}

export async function getPage(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [p] = await db<{ id: string; slug: string; title: string; draft_body: string; published_body: string | null; status: string; published_at: Date | null; updated_at: Date }[]>`
    select * from public.cms_pages where id = ${id}`;
  return p ?? null;
}

export async function savePage(db: Db, actor: Actor, p: { id?: string; slug: string; title: string; body: string }) {
  const slug = slugify(p.slug || p.title);
  if (!slug) throw new Error("Slug is required");
  if (p.id) {
    await db`update public.cms_pages set slug = ${slug}, title = ${p.title}, draft_body = ${p.body}, updated_by = ${actor.id} where id = ${p.id}`;
    await logActivity(db, actor, { action: "page.save_draft", entity: "page", entityId: p.id, summary: `Saved draft of ${p.title}` });
    return p.id;
  }
  const [row] = await db<{ id: string }[]>`insert into public.cms_pages (slug, title, draft_body, updated_by) values (${slug}, ${p.title}, ${p.body}, ${actor.id}) returning id`;
  await logActivity(db, actor, { action: "page.create", entity: "page", entityId: row!.id, summary: `Created page ${p.title}` });
  return row!.id;
}

export async function setPagePublished(db: Db, actor: Actor, id: string, publish: boolean) {
  if (publish) {
    const [p] = await db<{ draft_body: string }[]>`select draft_body from public.cms_pages where id = ${id}`;
    if (!p?.draft_body.trim()) throw new Error("Write some content before publishing");
    await db`update public.cms_pages set published_body = draft_body, status = 'published', published_at = now(), updated_by = ${actor.id} where id = ${id}`;
  } else {
    await db`update public.cms_pages set status = 'unpublished', updated_by = ${actor.id} where id = ${id}`;
  }
  await logActivity(db, actor, { action: publish ? "page.publish" : "page.unpublish", entity: "page", entityId: id, summary: publish ? "Published page" : "Unpublished page" });
}

// ───────────────────────── Email ─────────────────────────

import { getEmailProvider } from "../../email/provider";
export { getEmailProvider, type EmailProvider } from "../../email/provider";

export function emailStatus(): { configured: boolean; detail: string } {
  return getEmailProvider()
    ? { configured: true, detail: "Email provider configured." }
    : { configured: false, detail: "No email provider is configured. Emails are logged with status “not configured” and are NOT delivered." };
}

/** Queues + sends an email. Without a provider the message is recorded as not_configured (never pretended as sent). */
export async function sendEmail(db: Db, msg: { to: string; subject: string; text: string; template?: string; orderId?: string | null }) {
  const provider = getEmailProvider();
  const [row] = await db<{ id: string }[]>`
    insert into public.email_outbox (to_address, subject, body_text, template, status, provider, related_order_id)
    values (${msg.to}, ${msg.subject}, ${msg.text}, ${msg.template ?? null}, ${provider ? "queued" : "not_configured"}, ${provider?.id ?? null}, ${msg.orderId ?? null})
    returning id`;
  if (!provider) return { id: row!.id, status: "not_configured" as const };
  try {
    const res = await provider.send({ to: msg.to, subject: msg.subject, text: msg.text });
    await db`update public.email_outbox set status = 'sent', provider_message_id = ${res.messageId}, sent_at = now() where id = ${row!.id}`;
    return { id: row!.id, status: "sent" as const };
  } catch (e) {
    await db`update public.email_outbox set status = 'failed', error = ${String((e as Error).message).slice(0, 500)} where id = ${row!.id}`;
    return { id: row!.id, status: "failed" as const };
  }
}

export async function listEmails(db: Db) {
  return db<{ id: string; to_address: string; subject: string; status: string; provider: string | null; error: string | null; created_at: Date }[]>`
    select id, to_address, subject, status, provider, error, created_at from public.email_outbox order by created_at desc limit 50`;
}

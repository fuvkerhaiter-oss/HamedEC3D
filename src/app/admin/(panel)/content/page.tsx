import Link from "next/link";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, EmptyState, Field, fmtDate, Notice, PageHeader, StatusBadge } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { emailStatus, listEmails, listPages } from "@/lib/admin/services/content";
import { getSql } from "@/lib/db/client";
import { getStorefrontSettings } from "@/lib/storefront/settings";
import { addLegalPagesAction, homeContentAction, savePageAction } from "../ops-actions";
import { countPlaceholders } from "@/lib/legal/fill";
import { LEGAL_PAGES } from "@/lib/legal/templates";
import { REQUIRED_LEGAL_PAGES } from "@/lib/checkout/service";

export const metadata = { title: "Website Content" };

export default async function ContentPage() {
  await requirePage("content.manage");
  const sql = getSql();
  const [pages, settings, emails] = await Promise.all([listPages(sql), getStorefrontSettings(), listEmails(sql)]);
  const h = settings.home;
  const email = emailStatus();
  const missingLegal = LEGAL_PAGES.filter((l) => !pages.some((p) => p.slug === l.slug));
  const unpublishedRequired = REQUIRED_LEGAL_PAGES.filter((s) => !pages.some((p) => p.slug === s && p.status === "published"));
  return (
    <>
      <PageHeader title="Website text" description="The homepage banner and pages like Terms or Returns. Leave a homepage field empty to keep the default text. Pages stay hidden until you publish them." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Homepage">
          <ActionForm action={homeContentAction} submitLabel="Publish homepage content">
            <Field label="Announcement bar" hint="Shown above the site header when set"><input name="announcement" defaultValue={h.announcement} maxLength={200} className="admin-input" /></Field>
            <Field label="Hero eyebrow"><input name="heroEyebrow" defaultValue={h.heroEyebrow} maxLength={80} placeholder="(default)" className="admin-input" /></Field>
            <Field label="Hero title"><input name="heroTitle" defaultValue={h.heroTitle} maxLength={120} placeholder="(default: WEGO SHIIIP)" className="admin-input" /></Field>
            <Field label="Hero subtitle"><textarea name="heroSubtitle" defaultValue={h.heroSubtitle} maxLength={400} rows={3} placeholder="(default)" className="admin-input" /></Field>
          </ActionForm>
        </Card>
        <Card title={`Pages (${pages.length})`}>
          {unpublishedRequired.length > 0 && (
            <Notice tone="warn">Not live yet: {unpublishedRequired.map((s) => `/pages/${s}`).join(", ")} — visitors see “page not found” and checkout refuses orders until Terms, Privacy and Returns are published.</Notice>
          )}
          {missingLegal.length > 0 && (
            <ActionForm action={addLegalPagesAction} submitLabel={`Add legal pages (${missingLegal.length})`} className="mt-3 rounded-xl bg-sand/50 p-4">
              <p className="text-sm">Adds ready-written drafts for {missingLegal.map((l) => l.title).join(", ")}. Your seller details from Settings (legal name, VAT, address) and SUPPORT_EMAIL are filled in automatically. Nothing goes live until you open a page, fill the remaining [brackets], have it reviewed, and press Publish.</p>
            </ActionForm>
          )}
          <p className="mt-3 text-xs text-ink-soft">Legal pages are templates: you or your lawyer must check and approve them before publishing.</p>
          {pages.length === 0 ? <div className="mt-4"><EmptyState title="No pages yet" /></div> : (
            <ul className="mt-4 divide-y divide-line">
              {pages.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <Link href={`/admin/content/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                  <span className="font-mono text-xs text-ink-soft">/pages/{p.slug}</span>
                  <StatusBadge status={p.status} />{countPlaceholders(p.draft_body) > 0 && <Badge tone="amber">{countPlaceholders(p.draft_body)} [brackets] to fill</Badge>}{p.has_unpublished_changes && p.status === "published" && <Badge tone="amber">unpublished changes</Badge>}
                  <span className="ml-auto text-xs text-ink-soft">{fmtDate(p.updated_at, false)}</span>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-4 rounded-xl border border-dashed border-line">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">+ New page</summary>
            <ActionForm action={savePageAction} submitLabel="Create draft" className="border-t border-line p-4" resetOnSuccess>
              <Field label="Title"><input name="title" required className="admin-input" /></Field>
              <Field label="Slug"><input name="slug" placeholder="from title" className="admin-input font-mono" /></Field>
              <Field label="Body" hint="Plain text; blank lines separate paragraphs, lines starting with # are headings."><textarea name="body" rows={6} className="admin-input" /></Field>
            </ActionForm>
          </details>
        </Card>
      </div>
      <Card title="Email delivery" className="mt-6">
        <Notice tone={email.configured ? "ok" : "warn"}>{email.detail}</Notice>
        {emails.length > 0 && (
          <ul className="mt-3 divide-y divide-line text-sm">{emails.map((e) => <li key={e.id} className="flex flex-wrap gap-2 py-2"><StatusBadge status={e.status} /><span>{e.subject}</span><span className="text-ink-soft">→ {e.to_address.replace(/(^.).*(@.*$)/, "$1•••$2")}</span><span className="ml-auto text-xs text-ink-soft">{fmtDate(e.created_at)}</span></li>)}</ul>
        )}
      </Card>
    </>
  );
}

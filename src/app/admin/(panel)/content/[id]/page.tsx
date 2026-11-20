import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/features/admin/ActionForm";
import { Card, Field, fmtDate, PageHeader, StatusBadge } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { getPage } from "@/lib/admin/services/content";
import { getSql } from "@/lib/db/client";
import { publishPageAction, savePageAction } from "../../ops-actions";

export const metadata = { title: "Edit page" };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("content.manage");
  const { id } = await params;
  const p = await getPage(getSql(), id);
  if (!p) notFound();
  const dirty = p.published_body !== p.draft_body;
  return (
    <>
      <PageHeader eyebrow={`/pages/${p.slug}`} title={p.title} description={<span className="flex items-center gap-2"><StatusBadge status={p.status} />{p.published_at && <span>Last published {fmtDate(p.published_at)}</span>}{dirty && p.status === "published" && <span className="text-amber-800">Draft differs from the live page</span>}</span>} actions={<Link className="btn-ghost" href="/admin/content">← Content</Link>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Draft" className="xl:col-span-2">
          <ActionForm action={savePageAction} submitLabel="Save draft">
            <input type="hidden" name="id" value={p.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title"><input name="title" defaultValue={p.title} required className="admin-input" /></Field>
              <Field label="Slug"><input name="slug" defaultValue={p.slug} className="admin-input font-mono" /></Field>
            </div>
            <Field label="Body" hint="Plain text; blank lines separate paragraphs, lines starting with # are headings."><textarea name="body" defaultValue={p.draft_body} rows={18} className="admin-input font-mono text-xs" /></Field>
          </ActionForm>
        </Card>
        <Card title="Publishing">
          <p className="text-sm text-ink-soft">Publishing copies the saved draft to the live page at <Link className="text-brand underline" href={`/pages/${p.slug}`} target="_blank">/pages/{p.slug}</Link>.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionForm action={publishPageAction} inline><input type="hidden" name="id" value={p.id} /><input type="hidden" name="publish" value="true" /><button className="btn-primary">Publish saved draft</button></ActionForm>
            {p.status === "published" && <ActionForm action={publishPageAction} inline confirm="Take this page offline?"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="publish" value="false" /><button className="btn-ghost">Unpublish</button></ActionForm>}
          </div>
        </Card>
      </div>
    </>
  );
}

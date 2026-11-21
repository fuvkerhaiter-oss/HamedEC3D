import Link from "next/link";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, EmptyState, fmtDate, PageHeader, StatusBadge } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { listReviews } from "@/lib/admin/services/people";
import { getSql } from "@/lib/db/client";
import { moderateAction } from "../ops-actions";

export const metadata = { title: "Reviews" };

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requirePage("reviews.moderate");
  const sp = await searchParams;
  const status = ["pending", "approved", "rejected", "hidden"].includes(sp.status ?? "") ? sp.status : sp.status === "all" ? undefined : "pending";
  const reviews = await listReviews(getSql(), status);
  return (
    <>
      <PageHeader title="Reviews" description="Reviews written by customers. Only the ones you approve are shown in the shop." />
      <nav className="mb-4 flex gap-1">{["pending", "approved", "rejected", "hidden", "all"].map((s) => <Link key={s} href={`?status=${s}`} className={`rounded-full px-3 py-1.5 text-sm ${(status ?? "all") === s ? "bg-ink text-cream" : "text-ink-soft hover:bg-sand/60"}`}>{s}</Link>)}</nav>
      {reviews.length === 0 ? <EmptyState title="No reviews here">Customer review submission arrives with storefront accounts; reviews will queue here for moderation.</EmptyState> : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span aria-label={`${r.rating} out of 5`} className="font-mono text-amber-700">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                <span className="font-medium">{r.title || "(no title)"}</span><StatusBadge status={r.status} />{r.is_verified_purchase && <Badge tone="green">verified purchase</Badge>}
                <span className="ml-auto text-xs text-ink-soft">{r.author_name} · {r.product_name} · {fmtDate(r.created_at)}</span>
              </div>
              {r.body && <p className="mt-2 whitespace-pre-wrap text-sm">{r.body}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {(["approved", "rejected", "hidden", "pending"] as const).filter((s) => s !== r.status).map((s) => (
                  <ActionForm key={s} action={moderateAction} inline hideMessage><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value={s} /><button className={s === "approved" ? "btn-primary" : s === "rejected" ? "btn-danger" : "btn-ghost"}>{s === "approved" ? "Approve" : s === "rejected" ? "Reject" : s === "hidden" ? "Hide" : "Back to pending"}</button></ActionForm>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

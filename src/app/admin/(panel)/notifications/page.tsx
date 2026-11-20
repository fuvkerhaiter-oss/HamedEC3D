import Link from "next/link";
import { ActionForm } from "@/features/admin/ActionForm";
import { EmptyState, fmtDate, PageHeader, StatusBadge } from "@/features/admin/ui";
import { requirePage } from "@/lib/admin/guard";
import { listNotifications } from "@/lib/admin/services/notifications";
import { getSql } from "@/lib/db/client";
import { markReadAction } from "../ops-actions";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ unread?: string }> }) {
  const session = await requirePage("notifications.view");
  const sp = await searchParams;
  const items = await listNotifications(getSql(), session.user.id, { unreadOnly: sp.unread === "1" });
  return (
    <>
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        description="Raised by real events: paid orders, low stock, supplier problems, failed refunds."
        actions={<>
          <Link className="btn-ghost" href={sp.unread === "1" ? "?" : "?unread=1"}>{sp.unread === "1" ? "Show all" : "Unread only"}</Link>
          <ActionForm action={markReadAction} inline hideMessage><input type="hidden" name="id" value="all" /><button className="btn-primary">Mark all read</button></ActionForm>
        </>}
      />
      {items.length === 0 ? <EmptyState title="You're all caught up" /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          {items.map((n) => (
            <li key={n.id} className={`flex flex-wrap items-start gap-3 px-5 py-3 ${n.read ? "" : "bg-amber/5"}`}>
              <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-amber"}`} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm"><StatusBadge status={n.severity} /><span className={n.read ? "" : "font-semibold"}>{n.title}</span></p>
                {n.body && <p className="mt-0.5 text-sm text-ink-soft">{n.body}</p>}
                <p className="mt-1 text-xs text-ink-soft">{fmtDate(n.created_at)}{n.link && <> · <Link href={n.link} className="text-brand underline">Open</Link></>}</p>
              </div>
              <ActionForm action={markReadAction} inline hideMessage>
                <input type="hidden" name="id" value={n.id} />{n.read && <input type="hidden" name="unread" value="true" />}
                <button className="btn-ghost !py-1 text-xs">{n.read ? "Mark unread" : "Mark read"}</button>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

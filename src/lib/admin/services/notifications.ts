/** Admin notifications (in-app). Broadcast to all admins; read state is per admin. */
import type { Db } from "../../db/client";

export interface NotifyInput {
  kind: string;
  title: string;
  body?: string;
  link?: string;
  severity?: "info" | "warning" | "critical";
  /** When set, a second notification with the same key is ignored (e.g. one low-stock alert per variant until cleared). */
  dedupeKey?: string;
}

export async function notify(db: Db, n: NotifyInput): Promise<void> {
  await db`
    insert into public.admin_notifications (kind, severity, title, body, link, dedupe_key)
    values (${n.kind}, ${n.severity ?? "info"}, ${n.title.slice(0, 200)}, ${(n.body ?? "").slice(0, 1000)}, ${n.link ?? null}, ${n.dedupeKey ?? null})
    on conflict (dedupe_key) do nothing`;
}

/** Allows a deduplicated alert to fire again (e.g. after stock was replenished). */
export async function clearDedupe(db: Db, dedupeKey: string): Promise<void> {
  await db`update public.admin_notifications set dedupe_key = null where dedupe_key = ${dedupeKey}`;
}

export interface NotificationRow {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  link: string | null;
  created_at: Date;
  read: boolean;
}

export async function listNotifications(db: Db, adminId: string, opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<NotificationRow[]> {
  return db<NotificationRow[]>`
    select n.id, n.kind, n.severity, n.title, n.body, n.link, n.created_at, (r.notification_id is not null) as read
      from public.admin_notifications n
      left join public.admin_notification_reads r on r.notification_id = n.id and r.admin_user_id = ${adminId}
     where (${opts.unreadOnly ?? false} = false or r.notification_id is null)
     order by n.created_at desc limit ${opts.limit ?? 100}`;
}

export async function unreadCount(db: Db, adminId: string): Promise<number> {
  const [r] = await db<{ n: number }[]>`
    select count(*)::int as n from public.admin_notifications n
     where not exists (select 1 from public.admin_notification_reads r where r.notification_id = n.id and r.admin_user_id = ${adminId})`;
  return r?.n ?? 0;
}

export async function markRead(db: Db, adminId: string, ids: string[] | "all"): Promise<void> {
  if (ids === "all") {
    await db`insert into public.admin_notification_reads (notification_id, admin_user_id)
             select id, ${adminId} from public.admin_notifications on conflict do nothing`;
  } else if (ids.length) {
    await db`insert into public.admin_notification_reads (notification_id, admin_user_id)
             select unnest(${ids}::uuid[]), ${adminId} on conflict do nothing`;
  }
}

export async function markUnread(db: Db, adminId: string, id: string): Promise<void> {
  await db`delete from public.admin_notification_reads where notification_id = ${id} and admin_user_id = ${adminId}`;
}

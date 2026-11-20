/** Append-only admin activity log (before/after snapshots). */
import type { Db } from "../db/client";

export interface Actor {
  id: string;
  email: string;
  ip?: string | null;
}

export interface ActivityInput {
  action: string; // e.g. "product.update"
  entity: string; // e.g. "product"
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
}

const json = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

export async function logActivity(db: Db, actor: Actor | null, a: ActivityInput): Promise<void> {
  await db`
    insert into public.admin_activity_log (admin_user_id, admin_email, action, entity, entity_id, summary, before, after, ip)
    values (${actor?.id ?? null}, ${actor?.email ?? null}, ${a.action}, ${a.entity}, ${a.entityId ?? null}, ${a.summary.slice(0, 500)},
            ${db.json(json(a.before))}, ${db.json(json(a.after))}, ${actor?.ip ?? null})`;
}

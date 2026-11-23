/**
 * Transactional outbox: order emails are QUEUED inside the same DB transaction as the status change and SENT
 * after commit (flushEmailOutbox). A rolled-back change never emails; a failed send is retried by the cron.
 */
import { inTx, type Db } from "../db/client";
import { orderUrl } from "../checkout/order-link";
import { getCustomerOrder } from "../checkout/order-view";
import type { OrderStatus } from "../orders/state-machine";
import { getEmailProvider } from "./provider";
import { orderEmail, textToHtml, type OrderEmailKind } from "./templates";

const KIND_FOR_STATUS: Partial<Record<OrderStatus, OrderEmailKind>> = {
  paid: "order_confirmed",
  shipped: "order_shipped",
  delivered: "order_delivered",
  failed: "payment_failed",
  refunded: "order_refunded",
  cancelled: "order_cancelled",
};
const MAX_ATTEMPT_AGE_HOURS = 48;

export function publicSiteUrl(env = process.env): string {
  return (env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Called in the status-change transaction. Unpaid cancellations (abandoned checkouts) don't email; `failed` emails the
 * customer only for a failed PAYMENT (a supplier problem after payment is handled by the shop, not the customer).
 * At most one email per (order, status): dedupe_key is UNIQUE.
 */
export async function queueOrderStatusEmail(tx: Db, orderId: string, from: OrderStatus, to: OrderStatus): Promise<void> {
  const kind = KIND_FOR_STATUS[to];
  if (!kind || (to === "cancelled" && from === "pending_payment") || (to === "failed" && from !== "pending_payment")) return;
  await queueOrderEmail(tx, orderId, kind, `status:${orderId}:${to}`);
}

/** Queue one customer email for an order; a repeated dedupeKey is ignored (no duplicate notifications). */
export async function queueOrderEmail(
  tx: Db, orderId: string, kind: OrderEmailKind, dedupeKey: string, extra?: Parameters<typeof orderEmail>[3],
): Promise<boolean> {
  const o = await getCustomerOrder(tx, orderId);
  if (!o) return false;
  const { subject, text, html } = orderEmail(kind, o, orderUrl(publicSiteUrl(), orderId), extra);
  const status = getEmailProvider() ? "queued" : "not_configured";
  const rows = await tx`insert into public.email_outbox (to_address, subject, body_text, body_html, template, status, related_order_id, dedupe_key)
           values (${o.email}, ${subject}, ${text}, ${html}, ${kind}, ${status}, ${orderId}, ${dedupeKey})
           on conflict (dedupe_key) where dedupe_key is not null do nothing returning id`;
  return rows.length > 0;
}

/** Sends queued emails (oldest first). Safe to call often and concurrently (rows are claimed with SKIP LOCKED). */
export async function flushEmailOutbox(db: Db, limit = 20): Promise<{ sent: number; failed: number }> {
  const provider = getEmailProvider();
  if (!provider) return { sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    const done = await inTx(db, async (tx) => {
      const [m] = await tx<{ id: string; to_address: string; subject: string; body_text: string; body_html: string | null }[]>`
        select id, to_address, subject, body_text, body_html from public.email_outbox
         where (status = 'queued' or (status = 'failed' and created_at > now() - make_interval(hours => ${MAX_ATTEMPT_AGE_HOURS})))
           and (sent_at is null)
         order by (status = 'failed'), created_at limit 1 for update skip locked`;
      if (!m) return null;
      try {
        const r = await provider.send({ to: m.to_address, subject: m.subject, text: m.body_text, html: m.body_html ?? textToHtml(m.subject, m.body_text) });
        await tx`update public.email_outbox set status = 'sent', provider = ${provider.id}, provider_message_id = ${r.messageId}, sent_at = now(), error = null where id = ${m.id}`;
        return "sent";
      } catch (e) {
        await tx`update public.email_outbox set status = 'failed', provider = ${provider.id}, error = ${String((e as Error).message).slice(0, 500)} where id = ${m.id}`;
        return "failed";
      }
    });
    if (!done) break;
    if (done === "sent") sent++;
    else failed++;
    if (done === "failed") break; // provider likely down: let the cron retry later
  }
  return { sent, failed };
}

/** Customer emails for order events. Plain text is the source; the HTML version is generated from it. */
import type { CustomerOrderView } from "../checkout/order-view";
import { MARKETS } from "../markets";
import { formatMoney } from "../money";

export type OrderEmailKind = "order_confirmed" | "order_shipped" | "order_refunded" | "order_cancelled";

export function orderEmail(kind: OrderEmailKind, o: CustomerOrderView, link: string): { subject: string; text: string } {
  const fmt = (m: CustomerOrderView["total"]) => formatMoney(m, o.total.currency === "USD" ? MARKETS.US.locale : MARKETS.EU.locale);
  const hello = `Hello ${o.shipTo.fullName.split(" ")[0] || "there"},`;
  const items = o.items.map((i) => `  ${i.quantity} × ${i.name}${i.variant && i.variant !== "Default" ? ` (${i.variant})` : ""}  ${fmt(i.lineTotal)}`).join("\n");
  const totals = [
    `  Subtotal  ${fmt(o.subtotal)}`,
    o.discount.amount > 0 ? `  Discount  −${fmt(o.discount)}` : null,
    `  Shipping  ${o.shipping.amount === 0 ? "Free" : fmt(o.shipping)}`,
    `  ${o.taxMode === "inclusive" ? "Incl. VAT" : "Sales tax"}  ${fmt(o.tax)}`,
    `  Total     ${fmt(o.total)}`,
  ].filter(Boolean).join("\n");
  const address = [o.shipTo.fullName, o.shipTo.line1, o.shipTo.line2, `${o.shipTo.postalCode} ${o.shipTo.city}${o.shipTo.region ? `, ${o.shipTo.region}` : ""}`, o.shipTo.country]
    .filter(Boolean).map((l) => `  ${l}`).join("\n");
  const footer = `\nFollow your order: ${link}\n\nQuestions? Just reply to this email with your order number #${o.orderNumber}.\n\nMega Market · Happy Family, Happy Animals`;

  switch (kind) {
    case "order_confirmed":
      return {
        subject: `Order #${o.orderNumber} confirmed — thank you!`,
        text: `${hello}\n\nThank you for shopping at Mega Market! We've received your payment and are preparing your order.\n\nOrder #${o.orderNumber}\n${items}\n\n${totals}\n\nDelivery to:\n${address}\n${o.shippingMethod ? `Shipping method: ${o.shippingMethod}\n` : ""}\nWe'll email you the tracking number as soon as it ships.\n\nEU customers: you may withdraw from this purchase within 14 days of delivery. See our returns policy for how.\n${footer}`,
      };
    case "order_shipped": {
      const tracking = o.shipments.map((s) => `  ${s.carrier}: ${s.trackingNumber}${s.trackingUrl ? `\n  ${s.trackingUrl}` : ""}`).join("\n");
      return {
        subject: `Order #${o.orderNumber} is on its way`,
        text: `${hello}\n\nGood news: your order #${o.orderNumber} has shipped.\n\nTracking:\n${tracking || "  (tracking details will follow)"}\n\nDelivery to:\n${address}\n${footer}`,
      };
    }
    case "order_refunded":
      return {
        subject: `Refund for order #${o.orderNumber}`,
        text: `${hello}\n\nWe've refunded your order #${o.orderNumber}. Depending on your bank it can take 5–10 business days to appear on your statement.\n${footer}`,
      };
    case "order_cancelled":
      return {
        subject: `Order #${o.orderNumber} cancelled`,
        text: `${hello}\n\nYour order #${o.orderNumber} has been cancelled. If you were charged, the refund is on its way.\n${footer}`,
      };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Branded HTML from the plain-text body (escaped; URLs become links). */
export function textToHtml(subject: string, text: string): string {
  const body = esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#111513">$1</a>').replace(/\n/g, "<br>");
  return `<!doctype html><html><body style="margin:0;background:#f7f4ee;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111513">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
<p style="font-size:20px;font-weight:700;margin:0 0 24px">Mega<span style="color:#e0a526">Market</span></p>
<div style="background:#fff;border-radius:16px;padding:28px;font-size:15px;line-height:1.6">
<h1 style="font-size:20px;margin:0 0 16px">${esc(subject)}</h1><div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;white-space:normal">${body}</div></div>
</div></body></html>`;
}

/**
 * Customer emails for order events, order-history links, contact messages and OTP codes.
 * Plain text is the deliverability/log source; the HTML version uses the shared brand shell in `layout.ts`.
 */
import type { CustomerOrderView } from "../checkout/order-view";
import { MARKETS } from "../markets";
import { formatMoney } from "../money";
import {
  addressCard, button, detailRows, EMAIL_COLORS, escapeHtml, itemTable, label, link, note, orderHero, p, panel,
  phtml, renderEmail, totalsTable, trackingCard, defaultSiteUrl, type EmailItem, type EmailTotal,
} from "./layout";

export type OrderEmailKind =
  | "order_confirmed" | "order_shipped" | "order_delivered" | "order_refunded" | "order_cancelled" | "payment_failed" | "refund_partial";

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

function originOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return defaultSiteUrl();
  }
}

function moneyFormatter(o: CustomerOrderView) {
  const locale = o.total.currency === "USD" ? MARKETS.US.locale : MARKETS.EU.locale;
  return (m: CustomerOrderView["total"]) => formatMoney(m, locale);
}

function itemsFor(o: CustomerOrderView, fmt: (m: CustomerOrderView["total"]) => string): EmailItem[] {
  return o.items.map((i) => ({ name: i.name, variant: i.variant, quantity: i.quantity, amount: fmt(i.lineTotal) }));
}

function totalsFor(o: CustomerOrderView, fmt: (m: CustomerOrderView["total"]) => string): EmailTotal[] {
  return [
    { label: "Subtotal", value: fmt(o.subtotal), muted: true },
    ...(o.discount.amount > 0 ? [{ label: "Discount", value: `−${fmt(o.discount)}`, muted: true }] : []),
    { label: "Shipping", value: o.shipping.amount === 0 ? "Free" : fmt(o.shipping), muted: true },
    { label: o.taxMode === "inclusive" ? "Incl. VAT" : "Sales tax", value: fmt(o.tax), muted: true },
    { label: "Total", value: fmt(o.total), emphasis: true },
  ];
}

function addressLines(o: CustomerOrderView): string[] {
  return [
    o.shipTo.fullName,
    o.shipTo.line1,
    o.shipTo.line2 ?? "",
    `${o.shipTo.postalCode} ${o.shipTo.city}${o.shipTo.region ? `, ${o.shipTo.region}` : ""}`,
    o.shipTo.country,
  ].filter(Boolean);
}

function textItems(o: CustomerOrderView, fmt: (m: CustomerOrderView["total"]) => string): string {
  return o.items.map((i) => `  ${i.quantity} × ${i.name}${i.variant && i.variant !== "Default" ? ` (${i.variant})` : ""}  ${fmt(i.lineTotal)}`).join("\n");
}

function textTotals(o: CustomerOrderView, fmt: (m: CustomerOrderView["total"]) => string): string {
  return [
    `  Subtotal  ${fmt(o.subtotal)}`,
    o.discount.amount > 0 ? `  Discount  −${fmt(o.discount)}` : null,
    `  Shipping  ${o.shipping.amount === 0 ? "Free" : fmt(o.shipping)}`,
    `  ${o.taxMode === "inclusive" ? "Incl. VAT" : "Sales tax"}  ${fmt(o.tax)}`,
    `  Total     ${fmt(o.total)}`,
  ].filter(Boolean).join("\n");
}

function textAddress(o: CustomerOrderView): string {
  return addressLines(o).map((l) => `  ${l}`).join("\n");
}

export function orderEmail(
  kind: OrderEmailKind, o: CustomerOrderView, link: string, extra: { refundAmount?: CustomerOrderView["total"] } = {},
): EmailContent {
  const fmt = moneyFormatter(o);
  const site = originOf(link);
  const first = o.shipTo.fullName.split(" ")[0] || "there";
  const hello = `Hello ${first},`;
  const items = textItems(o, fmt);
  const totals = textTotals(o, fmt);
  const address = textAddress(o);
  // Same signed token opens the online withdrawal form (EU "withdraw from contract" function).
  const withdrawLink = link.replace("/order?", "/withdraw?");
  const footer = `\nFollow your order: ${link}\n\nQuestions? Just reply to this email with your order number #${o.orderNumber}.\n\nWEGO SHIIIP · Happy Family, Happy Animals`;
  const addressHtml = addressCard("Delivery address", addressLines(o));
  const orderLinkButton = button(link, "View your order");

  switch (kind) {
    case "order_confirmed": {
      const subject = `Order #${o.orderNumber} confirmed — thank you!`;
      const text = `${hello}\n\nThank you for shopping at WEGO SHIIIP! We've received your payment and are preparing your order.\n\nOrder #${o.orderNumber}\n${items}\n\n${totals}\n\nDelivery to:\n${address}\n${o.shippingMethod ? `Shipping method: ${o.shippingMethod}\n` : ""}\nWe'll email you the tracking number as soon as it ships.\n\nEU customers: you may withdraw from this purchase within 14 days of delivery. Withdraw from contract online: ${withdrawLink}\n${footer}`;
      const html = renderEmail({
        subject,
        siteUrl: site,
        eyebrow: "Order confirmed",
        heading: `Thank you, ${first}.`,
        intro: "We've received your payment and we're getting your order ready. Here is everything you ordered.",
        preheader: `Order #${o.orderNumber} confirmed · ${fmt(o.total)} · WEGO SHIIIP`,
        content: [
          orderHero(o.orderNumber, fmt(o.total), "Total paid"),
          label("Your order"),
          itemTable(itemsFor(o, fmt)),
          totalsTable(totalsFor(o, fmt)),
          twoCols(
            addressHtml,
            addressCard("Shipping method", [o.shippingMethod ?? "Standard delivery", o.deliveryEstimate ? `Estimated ${o.deliveryEstimate.minDays}–${o.deliveryEstimate.maxDays} business days` : ""]),
          ),
          note("We'll email you the tracking number as soon as it ships."),
          phtml(`<strong style="color:${EMAIL_COLORS.ink}">EU customers:</strong> you may withdraw from this purchase within 14 days of delivery. ${link(withdrawLink, "Withdraw from contract online")}.`),
          orderLinkButton,
        ].join(""),
      });
      return { subject, text, html };
    }

    case "payment_failed": {
      const subject = `Payment for order #${o.orderNumber} did not go through`;
      const text = `${hello}\n\nThe payment for your order #${o.orderNumber} was not completed, so you have not been charged and the order will not be shipped.\n\nYou can place the order again from your cart whenever you like.\n${footer}`;
      const html = renderEmail({
        subject,
        siteUrl: site,
        eyebrow: "Payment not completed",
        heading: "That payment didn't go through.",
        intro: `You have not been charged, and order #${o.orderNumber} will not be shipped. Your cart is still waiting for you.`,
        preheader: `No charge was made for order #${o.orderNumber}`,
        content: [
          orderHero(o.orderNumber, fmt(o.total), "Not charged"),
          label("Your order"),
          itemTable(itemsFor(o, fmt)),
          totalsTable(totalsFor(o, fmt)),
          note("You can place the order again from your cart whenever you like.", "muted"),
          orderLinkButton,
          button(site, "Back to the shop", "ghost"),
        ].join(""),
      });
      return { subject, text, html };
    }

    case "order_delivered": {
      const subject = `Order #${o.orderNumber} has been delivered`;
      const text = `${hello}\n\nThe carrier reports that your order #${o.orderNumber} has been delivered. We hope you enjoy it!\n\nIf something is missing or damaged, reply to this email with your order number.\n\nEU customers: the 14-day withdrawal period starts on the day of delivery. Withdraw from contract online: ${withdrawLink}\n${footer}`;
      const html = renderEmail({
        subject,
        siteUrl: site,
        eyebrow: "Delivered",
        heading: "Delivered. Enjoy!",
        intro: `The carrier reports that order #${o.orderNumber} has been delivered. We hope everything is just right.`,
        preheader: `Order #${o.orderNumber} was delivered — here's what to do if something's wrong`,
        content: [
          orderHero(o.orderNumber, fmt(o.total), "Delivered"),
          label("In your parcel"),
          itemTable(itemsFor(o, fmt)),
          note("If something is missing or damaged, reply to this email with your order number and we'll sort it out."),
          phtml(`<strong style="color:${EMAIL_COLORS.ink}">EU customers:</strong> the 14-day withdrawal period starts on the day of delivery. ${link(withdrawLink, "Withdraw from contract online")}.`),
          orderLinkButton,
        ].join(""),
      });
      return { subject, text, html };
    }

    case "refund_partial": {
      const amount = extra.refundAmount ? fmt(extra.refundAmount) : "part of your payment";
      const subject = `Partial refund for order #${o.orderNumber}`;
      const text = `${hello}\n\nWe have refunded ${amount} for your order #${o.orderNumber}. Depending on your bank it can take 5–10 business days to appear on your statement.\n${footer}`;
      const html = renderEmail({
        subject,
        siteUrl: site,
        eyebrow: "Partial refund",
        heading: "A refund is on its way.",
        intro: `We've refunded ${amount} for order #${o.orderNumber}.`,
        preheader: `${amount} refunded for order #${o.orderNumber}`,
        content: [
          orderHero(o.orderNumber, extra.refundAmount ? fmt(extra.refundAmount) : "Refund issued", "Refunded"),
          note("Depending on your bank it can take 5–10 business days to appear on your statement."),
          orderLinkButton,
        ].join(""),
      });
      return { subject, text, html };
    }

    case "order_shipped": {
      const estimate = o.deliveryEstimate
        ? `\nEstimated delivery: ${o.deliveryEstimate.minDays}–${o.deliveryEstimate.maxDays} business days (an estimate, not a guaranteed date).\n`
        : "";
      const tracking = o.shipments.map((s) => `  ${s.carrier}: ${s.trackingNumber}${s.trackingUrl ? `\n  ${s.trackingUrl}` : ""}`).join("\n");
      const subject = `Order #${o.orderNumber} is on its way`;
      const text = `${hello}\n\nGood news: your order #${o.orderNumber} has shipped.\n\nTracking:\n${tracking || "  (tracking details will follow)"}\n${estimate}\nDelivery to:\n${address}\n${footer}`;
      const trackingHtml = o.shipments.length
        ? o.shipments.map((s) => trackingCard({ carrier: s.carrier, trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl })).join("")
        : note("Tracking details will follow shortly.", "muted");
      const html = renderEmail({
        subject,
        siteUrl: site,
        eyebrow: "On its way",
        heading: "Your order is on its way.",
        intro: `Good news — order #${o.orderNumber} has shipped.`,
        preheader: `Order #${o.orderNumber} has shipped${o.shipments[0] ? ` · ${o.shipments[0].carrier} ${o.shipments[0].trackingNumber}` : ""}`,
        content: [
          orderHero(o.orderNumber, fmt(o.total)),
          label(o.shipments.length > 1 ? "Tracking" : "Tracking number"),
          trackingHtml,
          o.deliveryEstimate
            ? note(`Estimated delivery: <strong style="color:${EMAIL_COLORS.ink}">${o.deliveryEstimate.minDays}–${o.deliveryEstimate.maxDays} business days</strong>. This is an estimate, not a guaranteed date.`, "green")
            : "",
          addressHtml,
          label("In this parcel"),
          itemTable(itemsFor(o, fmt)),
          orderLinkButton,
        ].join(""),
      });
      return { subject, text, html };
    }

    case "order_refunded": {
      const refunded = o.refunds.filter((r) => r.status === "completed").reduce((sum, r) => sum + r.amount.amount, 0);
      const amount = refunded > 0 ? { amount: refunded, currency: o.total.currency } : o.total;
      const subject = `Refund for order #${o.orderNumber}`;
      const text = `${hello}\n\nWe've refunded your order #${o.orderNumber}. Depending on your bank it can take 5–10 business days to appear on your statement.\n${footer}`;
      const html = renderEmail({
        subject,
        siteUrl: site,
        eyebrow: "Refunded",
        heading: "Your refund is on its way.",
        intro: `We've refunded order #${o.orderNumber}.`,
        preheader: `Refund issued for order #${o.orderNumber}`,
        content: [
          orderHero(o.orderNumber, fmt(amount), "Refunded"),
          note("Depending on your bank it can take 5–10 business days to appear on your statement."),
          orderLinkButton,
        ].join(""),
      });
      return { subject, text, html };
    }

    case "order_cancelled": {
      const subject = `Order #${o.orderNumber} cancelled`;
      const text = `${hello}\n\nYour order #${o.orderNumber} has been cancelled. If you were charged, the refund is on its way.\n${footer}`;
      const html = renderEmail({
        subject,
        siteUrl: site,
        eyebrow: "Cancelled",
        heading: `Order #${o.orderNumber} is cancelled.`,
        intro: "Your order has been cancelled. If you were charged, the refund is on its way.",
        preheader: `Order #${o.orderNumber} was cancelled`,
        content: [
          note("Nothing will be shipped for this order.", "muted"),
          orderLinkButton,
          button(site, "Back to the shop", "ghost"),
        ].join(""),
      });
      return { subject, text, html };
    }
  }
}

/** Private order-history link (24 h by default). Sent only to an address that already has orders. */
export function orderHistoryEmail(url: string, hours = 24): EmailContent {
  const site = originOf(url);
  const subject = "Your WEGO SHIIIP orders";
  const text = `Hello,\n\nHere is your private link to see all your WEGO SHIIIP orders, their tracking and refund status:\n\n${url}\n\nThe link works for ${hours} hours. If you didn't ask for it, you can ignore this email.\n\nWEGO SHIIIP · Happy Family, Happy Animals`;
  const html = renderEmail({
    subject,
    siteUrl: site,
    eyebrow: "Your orders",
    heading: "Your orders, in one place.",
    intro: "Here is your private link to see all your WEGO SHIIIP orders, their tracking and refund status.",
    preheader: `Your private WEGO SHIIIP order link — valid for ${hours} hours`,
    content: [
      button(url, "View my orders"),
      note(`This private link works for <strong style="color:${EMAIL_COLORS.ink}">${hours} hours</strong>. If you didn't ask for it, you can ignore this email.`),
      p("For your security, we only send this link to an address that has already ordered from us."),
    ].join(""),
    footerNote: "You received this email because someone requested an order-history link for this address.",
  });
  return { subject, text, html };
}

/** Contact-form message delivered to the support inbox, with the customer as reply-to. */
export function customerMessageEmail(p: { name: string; email: string; orderNumber?: string | null; message: string }): EmailContent {
  const order = p.orderNumber ?? null;
  const subject = `Customer message${order ? ` · order #${order}` : ""} · ${p.name}`;
  const text = `From: ${p.name} <${p.email}>\n${order ? `Order: #${order}\n` : ""}\n${p.message}`;
  const html = renderEmail({
    subject,
    internal: true,
    eyebrow: "Customer message",
    heading: `New message from ${p.name}.`,
    intro: "A customer sent a message through the WEGO SHIIIP contact form.",
    preheader: `${p.name}${order ? ` · order #${order}` : ""}: ${p.message.slice(0, 90)}`,
    content: [
      panel(detailRows([
        { label: "From", value: p.name },
        { label: "Email", value: p.email },
        ...(order ? [{ label: "Order", value: `#${order}` }] : []),
      ]), "white"),
      label("Message"),
      panel(escapeHtml(p.message).replace(/\n/g, "<br>"), "sand"),
      button(`mailto:${p.email}?subject=${encodeURIComponent(`Re: ${subject}`)}`, "Reply to customer", "dark"),
    ].join(""),
    footerNote: "Internal notification from the WEGO SHIIIP storefront.",
  });
  return { subject, text, html };
}

/** Branded verification code email (used for previews and any custom Supabase send-email hook). */
export function authOtpEmail(otp: string, expiresMinutes = 60): EmailContent {
  const subject = `Your WEGO SHIIIP verification code: ${otp}`;
  const text = `Hello,\n\nYour WEGO SHIIIP verification code is:\n\n  ${otp}\n\nThis code expires in ${expiresMinutes} minutes. If you don't see this email in your inbox, check the spam aisle.\n\nIf you did not request this code, no worries — your trolley is safe and you can ignore this message.\n\nWEGO SHIIIP · Happy Family, Happy Animals`;
  const boxes = otp
    .split("")
    .map((digit) => `<td align="center" style="padding:0 4px"><div style="width:44px;height:58px;background:${EMAIL_COLORS.sand};border:1px solid ${EMAIL_COLORS.line};border-radius:12px;font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;font-size:30px;line-height:58px;font-weight:700;color:${EMAIL_COLORS.ink};text-align:center">${escapeHtml(digit)}</div></td>`)
    .join("");
  const html = renderEmail({
    subject,
    eyebrow: "Sign in",
    heading: "Your verification code.",
    intro: `Enter this code to sign in to WEGO SHIIIP. It expires in ${expiresMinutes} minutes.`,
    preheader: `Your WEGO SHIIIP code is ${otp} — expires in ${expiresMinutes} minutes`,
    content: [
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px auto 8px;border-collapse:separate"><tr>${boxes}</tr></table>`,
      note("If you didn't request this code, you can safely ignore this email. Your trolley is safe."),
    ].join(""),
    footerNote: "You received this email because someone requested a sign-in code for this address.",
  });
  return { subject, text, html };
}

/** Kept for compatibility with older imports; new code should use `orderHistoryEmail`. */
export function historyEmail(url: string, hours = 24): EmailContent {
  return orderHistoryEmail(url, hours);
}

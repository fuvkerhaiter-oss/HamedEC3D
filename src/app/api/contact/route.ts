import { NextResponse } from "next/server";
import { z } from "zod";
import { notify } from "@/lib/admin/services/notifications";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { getEmailProvider } from "@/lib/email/provider";
import { clientIp, rateLimited } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  orderNumber: z.string().trim().regex(/^#?\d{1,12}$/).optional().or(z.literal("")),
  message: z.string().trim().min(10).max(3000),
  website: z.string().max(0).optional(), // honeypot: bots fill every field
});

/**
 * Customer message → admin notification (always, so nothing is lost) + email to SUPPORT_EMAIL with the
 * customer as reply-to (when an email provider is configured).
 */
export async function POST(req: Request) {
  if (rateLimited(`contact:${clientIp(req)}`, 3, 10 * 60_000)) return NextResponse.json({ error: "Too many messages. Please try again later." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const f = parsed.error.issues[0]?.path[0];
    return NextResponse.json({ error: f === "message" ? "Please write at least a short message (10+ characters)." : f === "email" ? "Please enter a valid email." : "Please check the form." }, { status: 400 });
  }
  const { name, email, orderNumber, message } = parsed.data;
  if (!isDbConfigured()) return NextResponse.json({ error: "Messaging is not available right now. Please email us directly." }, { status: 503 });
  const order = orderNumber ? orderNumber.replace("#", "") : null;
  const subject = `Customer message${order ? ` · order #${order}` : ""} · ${name}`;
  const text = `From: ${name} <${email}>\n${order ? `Order: #${order}\n` : ""}\n${message}`;
  const db = getSql();

  await notify(db, { kind: "customer_message", title: subject, body: text, link: `mailto:${email}` });
  const to = process.env.SUPPORT_EMAIL ?? process.env.EMAIL_REPLY_TO;
  const provider = getEmailProvider();
  let status: "sent" | "failed" | "not_configured" = "not_configured";
  let messageId: string | null = null;
  if (provider && to) {
    try {
      messageId = (await provider.send({ to, subject, text, replyTo: email })).messageId;
      status = "sent";
    } catch (e) {
      console.error("contact email failed", e);
      status = "failed";
    }
  }
  await db`insert into public.email_outbox (to_address, subject, body_text, template, status, provider, provider_message_id, sent_at)
           values (${to ?? "(SUPPORT_EMAIL not set)"}, ${subject}, ${text}, 'customer_message', ${status}, ${provider?.id ?? null}, ${messageId}, ${status === "sent" ? new Date() : null})`;
  return NextResponse.json({ ok: true });
}

/**
 * Email delivery. Resend (https://resend.com) when RESEND_API_KEY + EMAIL_FROM are set; otherwise none
 * (messages are recorded as "not_configured" and never claimed as sent).
 */
export interface OutgoingEmail { to: string; subject: string; text: string; html?: string; replyTo?: string }
export interface EmailProvider { id: string; send(msg: OutgoingEmail): Promise<{ messageId: string }> }

export function getEmailProvider(env: NodeJS.ProcessEnv = process.env, doFetch: typeof fetch = fetch): EmailProvider | null {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim() || (key ? "WEGO SHIIIP <orders@wegoshiiip.com>" : null);
  if (!key || !from) return null;
  return {
    id: "resend",
    async send(msg) {
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html, reply_to: msg.replyTo ?? env.EMAIL_REPLY_TO }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok || !json.id) throw new Error(json.message ?? `Resend error ${res.status}`);
      return { messageId: json.id };
    },
  };
}

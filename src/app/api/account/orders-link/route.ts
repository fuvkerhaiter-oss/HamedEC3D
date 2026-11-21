import { after, NextResponse } from "next/server";
import { z } from "zod";
import { siteUrl } from "@/lib/checkout/order-link";
import { requestHistoryLink } from "@/lib/checkout/order-history";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { flushEmailOutbox } from "@/lib/email/outbox";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const SAME_ANSWER = "If we have orders for that address, we've emailed you a private link to see them. Check your inbox (and spam folder).";

/** Emails a signed order-history link. Always the same answer, whether or not the address has orders. */
export async function POST(req: Request) {
  if (rateLimited(`history:${clientIp(req)}`, 5, 60_000)) return NextResponse.json({ error: "Too many attempts. Please wait a minute." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the email address you ordered with." }, { status: 400 });
  if (!isDbConfigured()) return NextResponse.json({ error: "This is not available right now." }, { status: 503 });
  const db = getSql();
  const result = await requestHistoryLink(db, parsed.data.email, siteUrl(req));
  if (result === "queued") after(() => flushEmailOutbox(getSql()).catch((e) => logError("email flush failed", e)));
  return NextResponse.json({ message: SAME_ANSWER });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { orderUrl, siteUrl, withdrawUrl } from "@/lib/checkout/order-link";
import { getSql, isDbConfigured } from "@/lib/db/client";
import { clientIp, rateLimited } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  orderNumber: z.string().trim().regex(/^#?\d{1,12}$/),
  /** "withdraw" → link to the online withdrawal form instead of the order page. */
  target: z.enum(["order", "withdraw"]).optional(),
});

/** Guest order lookup: email + order number → signed order page link. Same answer for "wrong email" and "no such order". */
export async function POST(req: Request) {
  if (rateLimited(`lookup:${clientIp(req)}`, 5, 60_000)) return NextResponse.json({ error: "Too many attempts. Please wait a minute." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the email you ordered with and your order number." }, { status: 400 });
  if (!isDbConfigured()) return NextResponse.json({ error: "Order lookup is not available right now." }, { status: 503 });
  const num = parsed.data.orderNumber.replace("#", "");
  const [o] = await getSql()<{ id: string }[]>`
    select id from public.orders where order_number = ${num} and email = ${parsed.data.email}`;
  if (!o) return NextResponse.json({ error: "We couldn't find an order with that email and number." }, { status: 404 });
  const site = siteUrl(req);
  return NextResponse.json({ url: parsed.data.target === "withdraw" ? withdrawUrl(site, o.id) : orderUrl(site, o.id) });
}

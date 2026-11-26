import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { siteUrl, verifyLeaseToken } from "@/lib/checkout/order-link";
import { checkoutProvider, checkoutUnavailableReason } from "@/lib/checkout/service";
import { getSql } from "@/lib/db/client";
import { logError } from "@/lib/log";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { RentalBookingBody, RentalRenewBody } from "@/lib/rentals/schema";
import { RentalError, startRentalCheckout } from "@/lib/rentals/service";
import { getAuthUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Book (or extend) a rental shop and get the payment page URL. The client sends the shop, plan, currency and the
 * brand's details; the price is computed on the server and the shop is held while the tenant pays.
 */
export async function POST(req: Request) {
  if (rateLimited(`rental:${clientIp(req)}`, 6, 60_000)) return NextResponse.json({ error: "Too many attempts. Please wait a minute." }, { status: 429 });
  const unavailable = checkoutUnavailableReason();
  const provider = checkoutProvider();
  if (unavailable || !provider) return NextResponse.json({ error: `Shop rentals can't be paid online yet. ${unavailable ?? ""}`.trim() }, { status: 503 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const renewing = !!body && typeof body.renewLeaseId === "string";
  const parsed = renewing ? RentalRenewBody.safeParse(body) : RentalBookingBody.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue?.message && issue.code === "custom" ? issue.message : `Please check: ${issue?.path.join(".") || "your details"}`, field: issue?.path[0] ?? null, message: issue?.message }, { status: 400 });
  }
  const db = getSql();
  try {
    let result;
    if ("renewLeaseId" in parsed.data) {
      const d = parsed.data;
      if (!verifyLeaseToken(d.renewLeaseId, d.token)) return NextResponse.json({ error: "This rental link is not valid." }, { status: 403 });
      result = await startRentalCheckout(db, { kind: "renew", leaseId: d.renewLeaseId, plan: d.plan, currency: d.currency }, { provider, siteUrl: siteUrl(req) });
    } else {
      const user = await getAuthUser().catch(() => null);
      result = await startRentalCheckout(db, { kind: "new", booking: parsed.data, userId: user?.id ?? null }, { provider, siteUrl: siteUrl(req) });
      revalidatePath("/rent-a-shop"); // the shop now shows as "being booked"
    }
    return NextResponse.json({ redirectUrl: result.redirectUrl, reference: result.reference }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof RentalError) return NextResponse.json({ error: e.message }, { status: 409 });
    logError("rental checkout failed", e);
    return NextResponse.json({ error: "We couldn't open the payment page. You have not been charged. Please try again." }, { status: 502 });
  }
}

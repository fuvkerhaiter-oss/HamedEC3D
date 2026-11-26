import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/server";
import { addCustomerAddress, listCustomerAddresses } from "@/lib/account/addresses";
import { addressProblem } from "@/lib/shipping/address";
import { rateLimited } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const AddressBody = z.object({
  fullName: z.string().trim().min(2).max(120),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(60).optional(),
  postalCode: z.string().trim().min(2).max(20),
  country: z.string().trim().length(2).transform((s) => s.toUpperCase()),
  phone: z.string().trim().max(40).optional(),
  isDefault: z.boolean().optional(),
}).superRefine((a, ctx) => {
  const problem = addressProblem(a);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const addresses = await listCustomerAddresses(user.id);
  return NextResponse.json({ addresses }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (rateLimited(`address-add:${user.id}`, 20, 10 * 60_000)) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });

  const parsed = AddressBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid address data" }, { status: 400 });
  }

  const id = await addCustomerAddress(user.id, parsed.data);
  if (!id) {
    return NextResponse.json({ error: "Failed to save address" }, { status: 500 });
  }

  return NextResponse.json({ success: true, id }, { status: 201 });
}

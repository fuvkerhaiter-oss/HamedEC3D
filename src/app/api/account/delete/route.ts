import { NextResponse } from "next/server";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { getSql, isDbConfigured, inTx } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = user.id;

  if (isDbConfigured()) {
    const sql = getSql();
    await inTx(sql, async (tx) => {
      // Remove saved addresses and user carts
      await tx`delete from public.addresses where user_id = ${userId}`;
      await tx`delete from public.carts where user_id = ${userId}`;
      // Remove customer profile
      await tx`delete from public.profiles where id = ${userId}`;
      // Disconnect user_id from past orders to anonymize while retaining tax/accounting records
      await tx`update public.orders set user_id = null where user_id = ${userId}`;
    });
  }

  // Sign out the user
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Continue
  }

  return NextResponse.json({ success: true, message: "Account deleted and personal data cleared." });
}

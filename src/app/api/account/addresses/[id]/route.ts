import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/supabase/server";
import { deleteCustomerAddress, setDefaultCustomerAddress } from "@/lib/account/addresses";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ok = await deleteCustomerAddress(user.id, id);
  if (!ok) {
    return NextResponse.json({ error: "Address not found or delete failed" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ok = await setDefaultCustomerAddress(user.id, id);
  if (!ok) {
    return NextResponse.json({ error: "Address not found or update failed" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

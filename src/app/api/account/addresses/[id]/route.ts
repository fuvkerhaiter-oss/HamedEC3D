import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/supabase/server";
import { deleteCustomerAddress, setDefaultCustomerAddress } from "@/lib/account/addresses";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => NextResponse.json({ error: "Address not found" }, { status: 404 });

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID.test(id)) return notFound();
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
  if (!UUID.test(id)) return notFound();
  const ok = await setDefaultCustomerAddress(user.id, id);
  if (!ok) {
    return NextResponse.json({ error: "Address not found or update failed" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

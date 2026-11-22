import { Card, PageHeader } from "@/features/admin/ui";
import { SupportersEditor } from "@/features/admin/SupportersEditor";
import { requirePage } from "@/lib/admin/guard";
import { getSetting } from "@/lib/admin/services/settings";
import { getSql } from "@/lib/db/client";
import { normalizeSupporters, SUPPORTERS_KEY } from "@/lib/storefront/supporters";

export const metadata = { title: "Supporters wall" };

export default async function SupportersPage() {
  // Super admins only: admins.manage is never part of another role and can't be granted as an extra.
  await requirePage("admins.manage");
  const wall = normalizeSupporters(await getSetting(getSql(), SUPPORTERS_KEY));
  return (
    <>
      <PageHeader
        title="Supporters wall"
        description="The people who supported WEGO SHIIIP from the beginning. Their names and countries are shown on a scrolling 3D board next to the “Coming soon” wing in the 3D store."
      />
      <Card>
        <SupportersEditor initial={wall} />
      </Card>
    </>
  );
}

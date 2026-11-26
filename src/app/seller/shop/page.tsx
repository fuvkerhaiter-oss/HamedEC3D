import { ImageUploader, OpenToggle, ProfileForm, RowAction } from "@/features/seller/forms";
import { Callout, Panel, PageTitle } from "@/features/seller/ui";
import { getSql } from "@/lib/db/client";
import { requireSeller } from "@/lib/tenants/access";
import { currentLease, mediaUrl, openBlocker, tenantStats } from "@/lib/tenants/service";
import { DoorStyleEditor } from "@/features/rentals/DoorStyleEditor";
import { doorStyleFrom } from "@/lib/rentals/door-style";
import { removeLogoAction, saveDoorAction } from "../actions";

export const metadata = { title: "Brand & shop" };

export default async function SellerShopPage() {
  const ctx = await requireSeller();
  if (!ctx) return null;
  const { tenant, leases } = ctx;
  const lease = currentLease(leases) ?? leases.find((l) => l.status === "active" || l.status === "pending_payment") ?? null;
  const stats = await tenantStats(getSql(), tenant.id);
  const logo = mediaUrl(tenant.logo_bucket, tenant.logo_path);
  return (
    <>
      <PageTitle title="Brand & shop" description="How your shop looks to shoppers: name, sign, colours, logo and contact details." />
      {tenant.suspended && (
        <div className="mb-5">
          <Callout tone="bad" title="Paused by our team">{tenant.suspended_reason ?? "Your shop is hidden from shoppers."}</Callout>
        </div>
      )}
      <div className="space-y-6">
        <Panel title="Open or close" description="When open, shoppers can walk into your shop and see your published products.">
          <OpenToggle open={tenant.storefront_open && !tenant.suspended} blocker={openBlocker(!!currentLease(leases), tenant.suspended, stats.published)} />
        </Panel>
        <Panel title="Logo" description="Shown on your shop's back wall and on your products.">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <ImageUploader target="logo" currentUrl={logo} label="Brand logo" />
            {logo && <RowAction action={removeLogoAction} fields={{}} confirm="Remove your logo?" className="btn-danger">Remove logo</RowAction>}
          </div>
        </Panel>
        <Panel title="Shop door & lighting" description="Make your entrance stand out: pick the door colour and how its neon lights glow in the 3D store.">
          <DoorStyleEditor action={saveDoorAction} initial={doorStyleFrom(tenant)} />
        </Panel>
        <Panel title="Brand details">
          <ProfileForm t={tenant} signName={lease?.display_name ?? tenant.brand_name} signApproved={!!lease?.display_approved} />
        </Panel>
      </div>
    </>
  );
}

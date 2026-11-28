import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtPrice } from "@/features/rentals/format";
import { ImageUploader, ProductForm, RowAction } from "@/features/seller/forms";
import { Callout, PageTitle, Panel } from "@/features/seller/ui";
import { getSql } from "@/lib/db/client";
import { toDecimalString } from "@/lib/money";
import { requireSeller } from "@/lib/tenants/access";
import { linkHost } from "@/lib/tenants/payment-links";
import { getOwnProduct, mediaUrl } from "@/lib/tenants/service";
import { deleteProductAction } from "../../actions";

export const metadata = { title: "Edit product" };

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireSeller();
  if (!ctx) return null;
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const p = await getOwnProduct(getSql(), ctx.tenant.id, id);
  if (!p) notFound();
  const img = mediaUrl(p.image_bucket, p.image_path);
  const host = linkHost(p.payment_url ?? ctx.tenant.default_payment_url);
  return (
    <>
      <PageTitle title={p.title} eyebrow="Product" actions={<Link href="/seller/products" className="btn-ghost px-5 py-2.5">← All products</Link>} />
      {created && (
        <div className="mb-5">
          <Callout tone="ok" title="Product saved">Now add a photo: it&apos;s what shoppers see on your shelves.</Callout>
        </div>
      )}
      {p.hidden_by_admin && (
        <div className="mb-5">
          <Callout tone="bad" title="Hidden by our team">{p.hidden_reason ?? "This product doesn't show in the store."} Edit it and contact us to have it reviewed again.</Callout>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Panel title="Photo">
            <ImageUploader target="product" productId={p.id} currentUrl={img} label="Product photo" />
          </Panel>
          <Panel title="Details">
            <ProductForm
              product={{ id: p.id, title: p.title, description: p.description, price: toDecimalString({ amount: p.price, currency: p.currency }), currency: p.currency, payment_url: p.payment_url, status: p.status }}
              defaultCurrency={p.currency}
              hasDefaultLink={!!ctx.tenant.default_payment_url}
            />
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="In the store">
            {/* Mirrors the in-store product panel. */}
            <div className="overflow-hidden rounded-2xl ring-1 ring-line">
              <div className="aspect-square bg-sand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-ink-soft">Add a photo</div>}
              </div>
              <div className="p-4">
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: ctx.tenant.accent_color === "#ffffff" ? undefined : ctx.tenant.accent_color }}>{ctx.tenant.brand_name}</p>
                <p className="font-semibold">{p.title}</p>
                <p className="mt-1 font-display text-xl font-extrabold">{fmtPrice(p.price, p.currency)}</p>
                <span className={`mt-3 flex w-full justify-center rounded-full py-2.5 text-sm font-semibold ${host ? "bg-amber text-ink" : "bg-sand text-ink-soft"}`}>{host ? <>Buy on {host}<ArrowUpRight aria-hidden className="ml-1 inline h-4 w-4 align-[-3px]" /></> : "No payment link yet"}</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-soft">{p.views} views · {p.buy_clicks} buy clicks (all time)</p>
          </Panel>
          <Panel title="Delete">
            <p className="mb-3 text-sm text-ink-soft">Removes it from your shelves and your dashboard. This can&apos;t be undone.</p>
            <RowAction action={deleteProductAction} fields={{ id: p.id }} confirm={`Delete “${p.title}”? This can't be undone.`} className="btn-danger">Delete product</RowAction>
          </Panel>
        </div>
      </div>
    </>
  );
}

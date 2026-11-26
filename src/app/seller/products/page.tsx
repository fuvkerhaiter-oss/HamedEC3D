import Link from "next/link";
import { fmtPrice } from "@/features/rentals/format";
import { RowAction } from "@/features/seller/forms";
import { Callout, PageTitle, Panel, Pill } from "@/features/seller/ui";
import { getSql } from "@/lib/db/client";
import { requireSeller } from "@/lib/tenants/access";
import { linkHost } from "@/lib/tenants/payment-links";
import { listProducts, MAX_PRODUCTS, mediaUrl } from "@/lib/tenants/service";
import { moveProductAction, productStatusAction } from "../actions";

export const metadata = { title: "Products" };

export default async function SellerProductsPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const ctx = await requireSeller();
  if (!ctx) return null;
  const { deleted } = await searchParams;
  const products = await listProducts(getSql(), ctx.tenant.id);
  const full = products.length >= MAX_PRODUCTS;
  return (
    <>
      <PageTitle
        title="Products"
        description={`What's on your shelves, in shelf order (first = most visible, at eye level near the door). Up to ${MAX_PRODUCTS} products.`}
        actions={full ? <span className="text-sm text-ink-soft">Shelves full</span> : <Link href="/seller/products/new" className="btn-primary px-5 py-2.5">+ Add product</Link>}
      />
      {deleted && (
        <div className="mb-4">
          <Callout tone="ok">Product deleted.</Callout>
        </div>
      )}
      {products.length === 0 ? (
        <Panel>
          <div className="py-10 text-center">
            <p className="font-display text-2xl font-bold">Your shelves are empty</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">Add a product with a photo, a price and your payment link. It appears on the gondolas in your 3D shop as soon as you publish it.</p>
            <Link href="/seller/products/new" className="btn-yellow mt-5 px-6 py-3 text-sm">Add your first product</Link>
          </div>
        </Panel>
      ) : (
        <Panel pad={false}>
          <ul className="divide-y divide-line">
            {products.map((p, i) => {
              const img = mediaUrl(p.image_bucket, p.image_path);
              const host = linkHost(p.payment_url ?? ctx.tenant.default_payment_url);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <span className="w-6 text-center text-xs font-semibold text-ink-soft tabular-nums">{i + 1}</span>
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-sand ring-1 ring-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-[10px] text-ink-soft">No photo</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/seller/products/${p.id}`} className="font-semibold hover:underline">{p.title}</Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                      <span className="font-semibold text-ink">{fmtPrice(p.price, p.currency)}</span>
                      {p.hidden_by_admin ? <Pill tone="red">Hidden by our team</Pill> : p.status === "published" ? <Pill tone="green">On the shelves</Pill> : <Pill>Draft</Pill>}
                      {host ? <span className="text-xs">Pays on {host}</span> : <Pill tone="amber">No payment link</Pill>}
                      <span className="text-xs">{p.views} views · {p.buy_clicks} buy clicks</span>
                    </p>
                    {p.hidden_by_admin && p.hidden_reason && <p className="mt-1 text-xs text-red-700">{p.hidden_reason}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <RowAction action={moveProductAction} fields={{ id: p.id, dir: "up" }} className="btn-ghost px-2.5" >↑<span className="sr-only">Move up</span></RowAction>
                    <RowAction action={moveProductAction} fields={{ id: p.id, dir: "down" }} className="btn-ghost px-2.5">↓<span className="sr-only">Move down</span></RowAction>
                    <RowAction action={productStatusAction} fields={{ id: p.id, publish: p.status === "published" ? "false" : "true" }}>
                      {p.status === "published" ? "Unpublish" : "Publish"}
                    </RowAction>
                    <Link href={`/seller/products/${p.id}`} className="btn-primary">Edit</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </>
  );
}

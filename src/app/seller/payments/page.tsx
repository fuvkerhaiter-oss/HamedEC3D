import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { DefaultLinkForm } from "@/features/seller/forms";
import { Callout, PageTitle, Panel, Pill } from "@/features/seller/ui";
import { getSql } from "@/lib/db/client";
import { requireSeller } from "@/lib/tenants/access";
import { PAYMENT_LINK_PROVIDERS, providerOf } from "@/lib/tenants/payment-links";
import { currentLease, listProducts } from "@/lib/tenants/service";

export const metadata = { title: "Getting paid" };

export default async function SellerPaymentsPage() {
  const ctx = await requireSeller();
  if (!ctx) return null;
  const { tenant, leases } = ctx;
  const products = await listProducts(getSql(), tenant.id);
  const lease = currentLease(leases) ?? leases[0] ?? null;
  const fallback = tenant.default_payment_url;
  const withOwn = products.filter((p) => p.payment_url).length;
  const missing = products.filter((p) => !p.payment_url);
  const used = new Map<string, number>();
  for (const p of products) {
    const name = providerOf(p.payment_url)?.name ?? (p.payment_url ? "Other link" : null);
    if (name) used.set(name, (used.get(name) ?? 0) + 1);
  }
  return (
    <>
      <PageTitle title="Getting paid" description="Shoppers pay you directly, on your own payment page. The money goes straight to your account: we never touch it and take nothing from your sales." />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Panel title="How it works">
            <ol className="grid gap-3 sm:grid-cols-3">
              {[
                ["1", "Create a payment link", "In Stripe, PayPal, Shopify or another provider you already use."],
                ["2", "Paste it on your product", "Or set one default link for your whole shop below."],
                ["3", "Shoppers tap Buy", "They pay on your page; you ship the order as usual."],
              ].map(([n, t, d]) => (
                <li key={n} className="rounded-2xl bg-sand/60 p-4 ring-1 ring-line">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">{n}</span>
                  <p className="mt-2 font-semibold">{t}</p>
                  <p className="mt-0.5 text-sm text-ink-soft">{d}</p>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Default payment link" description="Optional. Used by every product that has no link of its own.">
            <DefaultLinkForm t={tenant} signName={lease?.display_name ?? tenant.brand_name} />
          </Panel>

          <Panel title="Where to get a link">
            <ul className="grid gap-3 sm:grid-cols-2">
              {PAYMENT_LINK_PROVIDERS.map((p) => (
                <li key={p.id} className="rounded-2xl p-4 ring-1 ring-line">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{p.name}</p>
                    {used.get(p.name) ? <Pill tone="green">{used.get(p.name)} product{used.get(p.name) === 1 ? "" : "s"}</Pill> : null}
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">{p.howTo}</p>
                  <a href={p.createUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold underline">
                    Open {p.name.split(" ")[0]}<ArrowUpRight aria-hidden className="ml-1 inline h-4 w-4 align-[-3px]" />
                  </a>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Your links">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-ink-soft">Products with their own link</span><b>{withOwn} / {products.length}</b></div>
              <div className="flex justify-between"><span className="text-ink-soft">Default link</span><b>{fallback ? providerOf(fallback)?.name ?? "Set" : "Not set"}</b></div>
            </div>
            {missing.length > 0 && !fallback && (
              <div className="mt-4">
                <Callout tone="warn" title={`${missing.length} product${missing.length === 1 ? "" : "s"} can't be bought yet`}>
                  <ul className="mt-1 space-y-0.5">
                    {missing.slice(0, 6).map((p) => (
                      <li key={p.id}><Link href={`/seller/products/${p.id}`} className="underline">{p.title}</Link></li>
                    ))}
                    {missing.length > 6 && <li>and {missing.length - 6} more</li>}
                  </ul>
                </Callout>
              </div>
            )}
          </Panel>
          <Callout title="Good to know">
            Prices in the store are what shoppers see first: keep them the same as on your payment page. Taxes, shipping, refunds and receipts are handled by you and your payment provider.
          </Callout>
        </div>
      </div>
    </>
  );
}

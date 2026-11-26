import Link from "next/link";
import { ProductForm } from "@/features/seller/forms";
import { Callout, PageTitle, Panel } from "@/features/seller/ui";
import { getSql } from "@/lib/db/client";
import { requireSeller } from "@/lib/tenants/access";
import { listProducts, MAX_PRODUCTS } from "@/lib/tenants/service";

export const metadata = { title: "Add a product" };

export default async function NewProductPage() {
  const ctx = await requireSeller();
  if (!ctx) return null;
  const count = (await listProducts(getSql(), ctx.tenant.id)).length;
  const currency = ctx.leases[0]?.currency ?? "EUR";
  return (
    <>
      <PageTitle title="Add a product" description="Save it first, then add its photo." actions={<Link href="/seller/products" className="btn-ghost px-5 py-2.5">← All products</Link>} />
      {count >= MAX_PRODUCTS ? (
        <Callout tone="warn" title="Your shelves are full">Your shop holds up to {MAX_PRODUCTS} products. Delete one to add another.</Callout>
      ) : (
        <Panel>
          <ProductForm product={null} defaultCurrency={currency} hasDefaultLink={!!ctx.tenant.default_payment_url} />
        </Panel>
      )}
    </>
  );
}

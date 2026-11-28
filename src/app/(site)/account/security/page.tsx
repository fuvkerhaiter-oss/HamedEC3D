import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { SecuritySettings } from "@/features/account/SecuritySettings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Security & Privacy", robots: { index: false } };

export default async function AccountSecurityPage() {
  const user = await getAuthUser();
  if (!user) {
    redirect("/account");
  }

  const provider = user.app_metadata?.provider || (user.identities && user.identities[0]?.provider) || "email";

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="eyebrow text-ink-soft">Your account</p>
          <h1 className="mt-1 font-display text-3xl text-ink sm:text-4xl">Security &amp; privacy</h1>
        </div>
        <Link
          href="/account"
          className="text-sm font-semibold text-ink underline decoration-amber decoration-2 underline-offset-4 hover:text-amber"
        >
          ← Back to Account Overview
        </Link>
      </div>

      <nav className="mt-6 flex gap-2 border-b border-line pb-3 overflow-x-auto text-sm font-medium">
        <Link href="/account" className="rounded-full px-4 py-1.5 text-ink-soft transition hover:bg-sand hover:text-ink">
          Overview
        </Link>
        <Link href="/account/orders" className="rounded-full px-4 py-1.5 text-ink-soft transition hover:bg-sand hover:text-ink">
          Orders
        </Link>
        <Link href="/account/addresses" className="rounded-full px-4 py-1.5 text-ink-soft transition hover:bg-sand hover:text-ink">
          Saved Addresses
        </Link>
        <Link href="/account/security" className="rounded-full bg-ink px-4 py-1.5 text-white">
          Security & Privacy
        </Link>
      </nav>

      <div className="mt-8">
        <SecuritySettings
          user={{
            id: user.id,
            email: user.email,
            createdAt: user.created_at,
            provider,
          }}
        />
      </div>
    </main>
  );
}

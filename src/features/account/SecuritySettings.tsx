"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SecuritySettings({
  user,
}: {
  user: {
    id: string;
    email?: string | null;
    createdAt: string;
    provider?: string;
  };
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDeleteAccount() {
    const confirmation = prompt(
      `To confirm account deletion, please type DELETE below.\nThis will clear your profile, saved addresses, and active sessions.`,
    );

    if (confirmation !== "DELETE") {
      alert("Account deletion cancelled (confirmation text did not match).");
      return;
    }

    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete account");
      alert("Your account has been deleted. Returning to homepage.");
      router.push("/");
      router.refresh();
    } catch (err) {
      setDeleteError((err as Error).message);
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Account Identity Card */}
      <section className="rounded-2xl bg-white p-6 ring-1 ring-line">
        <h2 className="font-display text-xl">Authentication & Identity</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 text-sm">
          <div className="rounded-2xl bg-cream/60 p-4">
            <dt className="text-xs text-ink-soft">Verified Email</dt>
            <dd className="mt-1 font-mono font-semibold text-ink">{user.email || "No email"}</dd>
          </div>
          <div className="rounded-2xl bg-cream/60 p-4">
            <dt className="text-xs text-ink-soft">Sign-In Method</dt>
            <dd className="mt-1 font-semibold text-ink capitalize">
              {user.provider === "google" ? "Google OAuth" : "Passwordless Email OTP"}
            </dd>
          </div>
          <div className="rounded-2xl bg-cream/60 p-4">
            <dt className="text-xs text-ink-soft">Customer ID</dt>
            <dd className="mt-1 font-mono text-xs text-ink-soft truncate">{user.id}</dd>
          </div>
          <div className="rounded-2xl bg-cream/60 p-4">
            <dt className="text-xs text-ink-soft">Account Created</dt>
            <dd className="mt-1 font-mono text-xs text-ink">{new Date(user.createdAt).toLocaleDateString()}</dd>
          </div>
        </dl>

        <div className="mt-6 pt-5 border-t border-line flex items-center justify-between">
          <p className="text-xs text-ink-soft">
            Signed in with HttpOnly encrypted SSR session cookies.
          </p>
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="rounded-full bg-ink px-5 py-2 text-xs font-semibold text-cream transition hover:bg-ink/80"
            >
              Sign Out Everywhere
            </button>
          </form>
        </div>
      </section>

      {/* Privacy & Account Deletion */}
      <section className="rounded-2xl bg-red-50/50 p-6 ring-1 ring-red-200">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-xl text-red-900">Privacy & Danger Zone</h2>
            <p className="mt-1 text-sm text-red-800/80 max-w-xl leading-relaxed">
              You can request complete deletion of your account. In accordance with GDPR and EU consumer rights,
              your saved addresses, carts, and customer profile will be permanently wiped.
              Past fiscal order snapshots are anonymized to fulfill European tax and invoicing laws.
            </p>
          </div>
        </div>

        {deleteError && (
          <p className="mt-4 rounded-xl bg-red-100 p-3 text-xs text-red-800 font-semibold">{deleteError}</p>
        )}

        <div className="mt-6 pt-4 border-t border-red-200 flex justify-end">
          <button
            onClick={handleDeleteAccount}
            disabled={deleting}
            className="rounded-full bg-red-600 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete My Account & Personal Data"}
          </button>
        </div>
      </section>
    </div>
  );
}

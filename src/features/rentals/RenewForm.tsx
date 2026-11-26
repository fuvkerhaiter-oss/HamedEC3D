"use client";

import { useState } from "react";
import type { RentalCurrency, RentalPlanId, RentalQuote } from "@/lib/rentals/pricing";
import { fmtPrice } from "./format";
import { PlanCards } from "./RentShop";

/** Extend a running rental (current tenant, signed lease link). The new term starts after the current one. */
export function RenewForm({ leaseId, token, currency, quotes }: { leaseId: string; token: string; currency: RentalCurrency; quotes: RentalQuote[] }) {
  const [plan, setPlan] = useState<RentalPlanId>("yearly");
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = quotes.find((x) => x.plan === plan)!;

  async function renew() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rentals/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renewLeaseId: leaseId, token, plan, currency, acceptTerms: accept }),
      });
      const json = (await res.json().catch(() => ({}))) as { redirectUrl?: string; error?: string };
      if (!res.ok || !json.redirectUrl) throw new Error(json.error ?? "Something went wrong. Please try again.");
      window.location.assign(json.redirectUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div>
      <PlanCards quotes={quotes} selected={plan} onSelect={setPlan} actionLabel="Extend" />
      <div className="mx-auto mt-8 max-w-md rounded-3xl bg-white p-6 ring-1 ring-line">
        <label className="flex gap-3 text-sm">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber" />
          <span>I accept the <a href="/rent-a-shop#terms" className="font-semibold underline" target="_blank" rel="noreferrer">shop rental terms</a>.</span>
        </label>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <button type="button" onClick={renew} disabled={!accept || busy} className="btn-dark mt-5 w-full justify-center py-3.5 disabled:opacity-50">
          {busy ? "Opening secure payment…" : `Extend by ${q.months} month${q.months > 1 ? "s" : ""} · ${fmtPrice(q.amount, currency)}`}
        </button>
      </div>
    </div>
  );
}

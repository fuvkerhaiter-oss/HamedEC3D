"use client";

import { useState } from "react";
import type { CustomerAddress } from "@/lib/account/addresses";
import { EU_COUNTRIES } from "@/lib/markets";
import { US_STATES } from "@/lib/shipping/address";

const FIELD = "mt-1 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-ink focus:ring-2 focus:ring-amber/40";
const LABEL = "block text-xs font-semibold text-ink-soft";

export function AddressManager({ initialAddresses }: { initialAddresses: CustomerAddress[] }) {
  const [addresses, setAddresses] = useState<CustomerAddress[]>(initialAddresses);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [country, setCountry] = useState("IT");
  const [region, setRegion] = useState("");

  const countries = [...EU_COUNTRIES, "US"].sort();

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");

    try {
      const res = await fetch("/api/account/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: get("fullName"),
          line1: get("line1"),
          line2: get("line2") || undefined,
          city: get("city"),
          region: region || undefined,
          postalCode: get("postalCode"),
          country,
          phone: get("phone") || undefined,
          isDefault: f.get("isDefault") === "on",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save address");

      // Reload list
      const listRes = await fetch("/api/account/addresses");
      const listData = await listRes.json();
      if (listData.addresses) setAddresses(listData.addresses);
      setShowAdd(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to remove this delivery address?")) return;
    try {
      const res = await fetch(`/api/account/addresses/${id}`, { method: "DELETE" });
      if (res.ok) {
        setAddresses((prev) => prev.filter((a) => a.id !== id));
      }
    } catch {
      // Ignored
    }
  }

  async function handleSetDefault(id: string) {
    try {
      const res = await fetch(`/api/account/addresses/${id}`, { method: "PATCH" });
      if (res.ok) {
        setAddresses((prev) =>
          prev.map((a) => ({ ...a, isDefault: a.id === id })),
        );
      }
    } catch {
      // Ignored
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-soft">
          Save your delivery addresses for seamless checkout in Europe and the United States.
        </p>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-full bg-amber px-5 py-2 text-sm font-bold text-ink shadow-[0_3px_0_var(--color-ink)] transition hover:-translate-y-0.5 active:translate-y-0.5"
          >
            + Add New Address
          </button>
        )}
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="rounded-3xl bg-white p-6 shadow-card ring-2 ring-amber space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-line">
            <h3 className="font-display text-lg font-bold">New Delivery Address</h3>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="text-xs font-semibold text-ink-soft hover:text-ink"
            >
              Cancel
            </button>
          </div>

          {error && <p className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className={LABEL}>Country</span>
              <select value={country} onChange={(e) => { setCountry(e.target.value); setRegion(""); }} className={FIELD}>
                {countries.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className={LABEL}>Full Name</span>
              <input name="fullName" required minLength={2} className={FIELD} placeholder="e.g. Maria Rossi" />
            </label>
            <label className="sm:col-span-2">
              <span className={LABEL}>Address Line 1</span>
              <input name="line1" required minLength={3} className={FIELD} placeholder="Street address, P.O. box" />
            </label>
            <label className="sm:col-span-2">
              <span className={LABEL}>Apartment, Suite, Unit (optional)</span>
              <input name="line2" className={FIELD} placeholder="Apt 4B" />
            </label>
            <label>
              <span className={LABEL}>Postal Code</span>
              <input name="postalCode" required className={FIELD} placeholder="00100 or 90210" />
            </label>
            <label>
              <span className={LABEL}>City</span>
              <input name="city" required className={FIELD} placeholder="Rome" />
            </label>
            {country === "US" && (
              <label>
                <span className={LABEL}>State</span>
                <select value={region} onChange={(e) => setRegion(e.target.value)} required className={FIELD}>
                  <option value="">Select State…</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            )}
            <label className={country === "US" ? "" : "sm:col-span-2"}>
              <span className={LABEL}>Phone (for courier, optional)</span>
              <input name="phone" type="tel" className={FIELD} placeholder="+39 333 1234567" />
            </label>
          </div>

          <label className="flex items-center gap-2 pt-2 text-xs font-medium cursor-pointer">
            <input name="isDefault" type="checkbox" className="h-4 w-4 rounded accent-amber" />
            Set as default shipping address
          </label>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-ink/80 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Address"}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft hover:bg-sand"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {addresses.length === 0 && !showAdd ? (
        <div className="rounded-3xl bg-white/70 p-10 text-center shadow-card">
          <span className="text-4xl">🏡</span>
          <h3 className="mt-3 font-display text-lg font-bold">No saved addresses</h3>
          <p className="mt-1 text-sm text-ink-soft max-w-sm mx-auto">
            Save a delivery address to breeze through checkout without looking up your postal code every time.
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-5 rounded-full bg-amber px-6 py-2.5 font-bold text-ink shadow-[0_3px_0_var(--color-ink)] transition hover:-translate-y-0.5"
          >
            Add Your First Address
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {addresses.map((a) => (
            <div
              key={a.id}
              className={`rounded-3xl bg-white p-5 shadow-card ring-1 flex flex-col justify-between ${
                a.isDefault ? "ring-2 ring-amber" : "ring-line"
              }`}
            >
              <div>
                <div className="flex items-start justify-between">
                  <span className="font-semibold text-ink">{a.fullName}</span>
                  {a.isDefault ? (
                    <span className="rounded-full bg-amber/30 px-2.5 py-0.5 text-xs font-bold text-ink">
                      Default
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSetDefault(a.id)}
                      className="text-xs text-ink-soft underline hover:text-ink"
                    >
                      Set default
                    </button>
                  )}
                </div>
                <div className="mt-2 text-sm leading-relaxed text-ink/80 font-normal">
                  <p>{a.line1}</p>
                  {a.line2 && <p>{a.line2}</p>}
                  <p>{a.postalCode} {a.city}{a.region ? `, ${a.region}` : ""}</p>
                  <p className="text-xs font-mono text-ink-soft">{a.country}</p>
                  {a.phone && <p className="text-xs text-ink-soft mt-1">📞 {a.phone}</p>}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-line flex justify-end">
                <button
                  onClick={() => handleDelete(a.id)}
                  className="text-xs font-semibold text-red-600 hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";

const FIELD = "mt-1 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 outline-none transition focus:border-ink focus:ring-2 focus:ring-amber/40";

async function post(url: string, body: unknown): Promise<{ ok: boolean; json: Record<string, string> }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, json: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, json: { error: "Network problem. Please try again." } };
  }
}

export function OrderLookupForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        const { ok, json } = await post("/api/orders/lookup", { email: f.get("email"), orderNumber: f.get("orderNumber") });
        if (ok && json.url) window.location.assign(json.url);
        else { setError(json.error ?? "Something went wrong."); setBusy(false); }
      }}
    >
      <label className="block"><span className="text-sm font-medium">Email used for the order</span><input name="email" type="email" required autoComplete="email" className={FIELD} /></label>
      <label className="block"><span className="text-sm font-medium">Order number</span><input name="orderNumber" required inputMode="numeric" placeholder="e.g. 100042" className={FIELD} /></label>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <button disabled={busy} className="w-full rounded-full bg-ink py-3 font-semibold text-cream disabled:opacity-50">{busy ? "Looking…" : "Find my order"}</button>
    </form>
  );
}

export function ContactForm() {
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  if (state === "sent") {
    return <p role="status" className="rounded-2xl bg-emerald-50 p-5 text-emerald-900">Thanks! Your message reached our team. We usually reply within 1–2 business days.</p>;
  }
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setState("busy");
        setError(null);
        const { ok, json } = await post("/api/contact", Object.fromEntries(f.entries()));
        if (ok) setState("sent");
        else { setError(json.error ?? "Something went wrong."); setState("idle"); }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="text-sm font-medium">Name</span><input name="name" required autoComplete="name" className={FIELD} /></label>
        <label className="block"><span className="text-sm font-medium">Email</span><input name="email" type="email" required autoComplete="email" className={FIELD} /></label>
      </div>
      <label className="block"><span className="text-sm font-medium">Order number <span className="font-normal text-ink-soft">(if about an order)</span></span><input name="orderNumber" inputMode="numeric" className={FIELD} /></label>
      <label className="block"><span className="text-sm font-medium">Message</span><textarea name="message" required minLength={10} maxLength={3000} rows={5} className={FIELD} /></label>
      {/* Honeypot: hidden from people, filled by bots. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <button disabled={state === "busy"} className="w-full rounded-full bg-ink py-3 font-semibold text-cream disabled:opacity-50">{state === "busy" ? "Sending…" : "Send message"}</button>
    </form>
  );
}

/** Asks for an emailed, signed link to all orders of an address (same answer whether or not it has orders). */
export function OrderHistoryRequestForm() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setMsg(null);
        const { ok, json } = await post("/api/account/orders-link", { email: f.get("email") });
        setMsg({ ok, text: (ok ? json.message : json.error) ?? "Something went wrong." });
        setBusy(false);
      }}
    >
      <label className="block"><span className="text-sm font-medium">Email used for your orders</span><input name="email" type="email" required autoComplete="email" className={FIELD} /></label>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>{msg.text}</p>}
      <button disabled={busy} className="w-full rounded-full bg-ink py-3 font-semibold text-cream disabled:opacity-50">{busy ? "Sending…" : "Email me my orders"}</button>
    </form>
  );
}

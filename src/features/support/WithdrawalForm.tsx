"use client";

import Link from "next/link";
import { useState } from "react";

const FIELD = "mt-1 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 outline-none transition focus:border-ink focus:ring-2 focus:ring-amber/40";

export interface WithdrawalFormItem { id: string; name: string; variant: string; left: number }

/**
 * Online withdrawal statement (EU art. 11a): name, order, email for the acknowledgement, items, optional reason,
 * then one clearly labelled "Confirm withdrawal" button. No reason is required.
 */
export function WithdrawalForm(props: { orderId: string; token: string; orderNumber: number; fullName: string; email: string; items: WithdrawalFormItem[] }) {
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(props.items.map((i) => [i.id, i.left])));
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ submittedAt: string; email: string } | null>(null);
  const selected = props.items.filter((i) => (qty[i.id] ?? 0) > 0);
  const all = props.items.every((i) => qty[i.id] === i.left);

  if (done) {
    return (
      <div role="status" className="rounded-3xl bg-emerald-50 p-6 text-emerald-950">
        <h2 className="font-display text-2xl">Your withdrawal has been received</h2>
        <p className="mt-2">
          Order #{props.orderNumber} · received on{" "}
          <b>{new Date(done.submittedAt).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}</b>.
        </p>
        <p className="mt-2">We&apos;ve sent an acknowledgement to <b>{done.email}</b>. Keep it as your proof. If you already have the goods, wait for our email with the return address: please don&apos;t send anything to the sender address on the parcel.</p>
        <p className="mt-4 text-sm"><Link href="/pages/returns" className="underline">How returns and refunds work</Link></p>
      </div>
    );
  }

  return (
    <form
      className="space-y-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setState("busy");
        setError(null);
        try {
          const r = await fetch("/api/orders/withdraw", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderId: props.orderId, token: props.token, fullName: f.get("fullName"), email: f.get("email"), reason: f.get("reason"),
              items: props.items.map((i) => ({ orderItemId: i.id, quantity: qty[i.id] ?? 0 })),
            }),
          });
          const json = (await r.json().catch(() => ({}))) as { submittedAt?: string; error?: string };
          if (r.ok && json.submittedAt) setDone({ submittedAt: json.submittedAt, email: String(f.get("email")) });
          else { setError(json.error ?? "Something went wrong. Your withdrawal was not recorded."); setState("idle"); }
        } catch {
          setError("Network problem. Your withdrawal was not recorded. Please try again.");
          setState("idle");
        }
      }}
    >
      <fieldset>
        <legend className="text-sm font-medium">What do you want to withdraw from?</legend>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <button type="button" onClick={() => setQty(Object.fromEntries(props.items.map((i) => [i.id, i.left])))} className={`rounded-full px-3 py-1.5 ring-1 ring-line ${all ? "bg-ink text-cream" : "bg-white"}`}>Whole order</button>
          <button type="button" onClick={() => setQty(Object.fromEntries(props.items.map((i) => [i.id, 0])))} className={`rounded-full px-3 py-1.5 ring-1 ring-line ${!all ? "bg-ink text-cream" : "bg-white"}`}>Only some items</button>
        </div>
        <ul className="mt-3 divide-y divide-line rounded-2xl bg-white ring-1 ring-line">
          {props.items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span>{i.name}{i.variant && i.variant !== "Default" ? <span className="text-ink-soft"> · {i.variant}</span> : null}</span>
              <label className="flex items-center gap-2">
                <span className="sr-only">Quantity of {i.name} to withdraw</span>
                <select value={qty[i.id] ?? 0} onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })} className="rounded-lg border border-line bg-white px-2 py-1">
                  {Array.from({ length: i.left + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="text-ink-soft">of {i.left}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="text-sm font-medium">Your name</span><input name="fullName" required maxLength={200} defaultValue={props.fullName} autoComplete="name" className={FIELD} /></label>
        <label className="block"><span className="text-sm font-medium">Email for the confirmation</span><input name="email" type="email" required maxLength={254} defaultValue={props.email} autoComplete="email" className={FIELD} /></label>
      </div>
      <label className="block">
        <span className="text-sm font-medium">Reason <span className="font-normal text-ink-soft">(optional — you don&apos;t have to give one)</span></span>
        <textarea name="reason" maxLength={1000} rows={3} className={FIELD} />
      </label>

      <p className="rounded-2xl bg-sand/60 p-4 text-sm leading-relaxed">
        By confirming, you withdraw from your contract for{" "}
        <b>{all ? "the whole order" : selected.length ? selected.map((i) => `${qty[i.id]} × ${i.name}`).join(", ") : "no items yet"}</b> of order #{props.orderNumber}.
        You will get an email confirming the date and time we received it.
      </p>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <button disabled={state === "busy" || selected.length === 0} className="w-full rounded-full bg-ink py-3.5 font-semibold text-cream disabled:opacity-50">
        {state === "busy" ? "Sending…" : "Confirm withdrawal"}
      </button>
    </form>
  );
}

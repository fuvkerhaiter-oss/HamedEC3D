"use client";

import { useRouter } from "next/navigation";
import { useActionState, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { checkPaymentLink, PAYMENT_LINK_PROVIDERS } from "@/lib/tenants/payment-links";
import type { SellerResult } from "@/lib/tenants/access";
import { saveProductAction, saveProfileAction, setOpenAction } from "@/app/seller/actions";
import { SignPreview } from "./ui";

type Action = (prev: SellerResult | null, fd: FormData) => Promise<SellerResult>;

export const inputCls = "admin-input";

export function Submit({ children, className = "btn-primary px-5 py-2.5", pendingText = "Saving…" }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingText : children}
    </button>
  );
}

export function Result({ state }: { state: SellerResult | null }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`rounded-xl px-3 py-2 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
      {state.ok ? (state.message ?? "Saved.") : state.error}
    </p>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold">
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs font-medium text-red-700">{error}</p> : hint ? <p className="mt-1 text-xs text-ink-soft">{hint}</p> : null}
    </div>
  );
}

/** Live-checked payment link: recognises the provider as you paste. */
export function PaymentLinkField({ name, defaultValue, error, label = "Payment link", hint }: { name: string; defaultValue?: string | null; error?: string; label?: string; hint?: React.ReactNode }) {
  const [value, setValue] = useState(defaultValue ?? "");
  const check = useMemo(() => (value.trim() ? checkPaymentLink(value) : null), [value]);
  return (
    <Field label={label} htmlFor={name} error={error} hint={!check ? hint : undefined}>
      <input id={name} name={name} className={inputCls} inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://buy.stripe.com/…" value={value} onChange={(e) => setValue(e.target.value)} />
      {check && !error && (
        <p className={`mt-1.5 flex flex-wrap items-center gap-2 text-xs ${check.ok ? "text-emerald-800" : "text-red-700"}`}>
          {check.ok ? (
            <>
              <span className="font-semibold">✓ {check.provider ? check.provider.name : `Link to ${check.host}`}</span>
              <a href={check.url} target="_blank" rel="noopener noreferrer" className="underline">
                Test it ↗
              </a>
              {!check.provider && <span className="text-ink-soft">(not a provider we recognise: make sure it&apos;s your real checkout page)</span>}
            </>
          ) : (
            check.error
          )}
        </p>
      )}
    </Field>
  );
}

const SWATCHES = ["#f7c416", "#e85d3f", "#d6336c", "#7048e8", "#1c7ed6", "#0ca678", "#2b8a3e", "#ffffff"];

export function ProfileForm({
  t,
  signName,
  signApproved,
}: {
  t: { brand_name: string; tagline: string | null; about: string | null; accent_color: string; website: string | null; instagram: string | null; tiktok: string | null; contact_email: string | null; contact_phone: string | null; default_payment_url: string | null };
  signName: string;
  signApproved: boolean;
}) {
  const [state, action] = useActionState(saveProfileAction as Action, null);
  const [sign, setSign] = useState(signName);
  const [accent, setAccent] = useState(t.accent_color);
  const fe = (!state?.ok && state?.fieldErrors) || {};
  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand name" htmlFor="brandName" error={fe.brandName}>
            <input id="brandName" name="brandName" className={inputCls} defaultValue={t.brand_name} maxLength={60} required />
          </Field>
          <Field label="Name on your 3D sign" htmlFor="signName" error={fe.signName} hint="Up to 40 characters. A new name is checked by our team before it shows.">
            <input id="signName" name="signName" className={inputCls} value={sign} onChange={(e) => setSign(e.target.value)} maxLength={40} required />
          </Field>
        </div>
        <Field label="Tagline" htmlFor="tagline" error={fe.tagline} hint="One line under your name, e.g. “Handmade dog toys from Milan”.">
          <input id="tagline" name="tagline" className={inputCls} defaultValue={t.tagline ?? ""} maxLength={90} />
        </Field>
        <Field label="About your brand" htmlFor="about" error={fe.about} hint="Shown when shoppers look at your products.">
          <textarea id="about" name="about" className={inputCls} defaultValue={t.about ?? ""} maxLength={1500} rows={4} />
        </Field>
        <Field label="Brand colour" error={fe.accentColor} hint="Used for your sign and product labels in the store.">
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setAccent(c)}
                aria-label={`Colour ${c}`}
                aria-pressed={accent === c}
                className={`h-8 w-8 rounded-full ring-1 ring-line transition ${accent === c ? "scale-110 outline outline-2 outline-offset-2 outline-ink" : ""}`}
                style={{ background: c }}
              />
            ))}
            <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-line bg-white" aria-label="Custom colour" />
            <input type="hidden" name="accentColor" value={accent} />
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Website" htmlFor="website" error={fe.website}>
            <input id="website" name="website" className={inputCls} defaultValue={t.website ?? ""} placeholder="mybrand.com" />
          </Field>
          <Field label="Instagram" htmlFor="instagram" error={fe.instagram}>
            <input id="instagram" name="instagram" className={inputCls} defaultValue={t.instagram ?? ""} placeholder="mybrand" />
          </Field>
          <Field label="TikTok" htmlFor="tiktok" error={fe.tiktok}>
            <input id="tiktok" name="tiktok" className={inputCls} defaultValue={t.tiktok ?? ""} placeholder="mybrand" />
          </Field>
          <Field label="Customer contact email" htmlFor="contactEmail" error={fe.contactEmail}>
            <input id="contactEmail" name="contactEmail" type="email" className={inputCls} defaultValue={t.contact_email ?? ""} />
          </Field>
          <Field label="Phone" htmlFor="contactPhone" error={fe.contactPhone}>
            <input id="contactPhone" name="contactPhone" className={inputCls} defaultValue={t.contact_phone ?? ""} />
          </Field>
        </div>
        <input type="hidden" name="defaultPaymentUrl" value={t.default_payment_url ?? ""} />
        <div className="flex flex-wrap items-center gap-3">
          <Submit>Save brand</Submit>
          <Result state={state} />
        </div>
      </div>
      <aside className="space-y-2">
        <p className="text-sm font-semibold">Your sign in the store</p>
        <SignPreview name={sign || t.brand_name} accent={accent} pending={sign.trim() !== signName || !signApproved} />
        <p className="text-xs text-ink-soft">{signApproved && sign.trim() === signName ? "Approved and showing above your shop." : "Shows “Opening soon” until our team approves the name."}</p>
      </aside>
    </form>
  );
}

/** Default (whole-shop) payment link, on the "Getting paid" page. Saves only that field. */
export function DefaultLinkForm({ t, signName }: { t: Parameters<typeof ProfileForm>[0]["t"]; signName: string }) {
  const [state, action] = useActionState(saveProfileAction as Action, null);
  const fe = (!state?.ok && state?.fieldErrors) || {};
  return (
    <form action={action} className="space-y-3">
      {(
        [
          ["brandName", t.brand_name],
          ["signName", signName],
          ["tagline", t.tagline],
          ["about", t.about],
          ["accentColor", t.accent_color],
          ["website", t.website],
          ["instagram", t.instagram],
          ["tiktok", t.tiktok],
          ["contactEmail", t.contact_email],
          ["contactPhone", t.contact_phone],
        ] as const
      ).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v ?? ""} />
      ))}
      <PaymentLinkField name="defaultPaymentUrl" defaultValue={t.default_payment_url} error={fe.defaultPaymentUrl} label="Default payment link (optional)" hint="Used for any product without its own link, e.g. your whole Shopify store or a PayPal.me link." />
      <div className="flex flex-wrap items-center gap-3">
        <Submit>Save link</Submit>
        <Result state={state} />
      </div>
    </form>
  );
}

export function OpenToggle({ open, blocker }: { open: boolean; blocker: string | null }) {
  const [state, action] = useActionState(setOpenAction as Action, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="open" value={open ? "false" : "true"} />
      {open ? (
        <Submit className="btn-ghost px-5 py-2.5" pendingText="Closing…">Close my shop</Submit>
      ) : (
        <Submit className="btn-yellow px-5 py-2.5 text-sm" pendingText="Opening…">
          Open my shop to shoppers
        </Submit>
      )}
      {blocker && !open && <span className="text-xs text-ink-soft">{blocker}</span>}
      <Result state={state} />
    </form>
  );
}

/** Upload a logo / product photo (re-encoded on the server). */
export function ImageUploader({ target, productId, currentUrl, label, square = true }: { target: "logo" | "product"; productId?: string; currentUrl: string | null; label: string; square?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const preview = uploaded ?? currentUrl;

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("target", target);
    if (productId) fd.set("productId", productId);
    try {
      const res = await fetch("/api/seller/image", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ?? "Upload failed.");
      setUploaded(body.url);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-sand ring-1 ring-line ${square ? "h-24 w-24" : "h-24 w-32"}`}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="px-2 text-center text-xs text-ink-soft">No image</span>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">{label}</p>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="btn-ghost">
          {busy ? "Uploading…" : preview ? "Replace image" : "Upload image"}
        </button>
        <p className="text-xs text-ink-soft">JPG, PNG or WebP, up to 10 MB. A square photo on a plain background looks best.</p>
        {error && <p className="text-xs font-medium text-red-700" role="alert">{error}</p>}
      </div>
    </div>
  );
}

export interface ProductFormValue {
  id: string;
  title: string;
  description: string | null;
  price: string;
  currency: "EUR" | "USD";
  payment_url: string | null;
  status: "draft" | "published";
}

export function ProductForm({ product, defaultCurrency, hasDefaultLink }: { product: ProductFormValue | null; defaultCurrency: "EUR" | "USD"; hasDefaultLink: boolean }) {
  const [state, action] = useActionState(saveProductAction as Action, null);
  const fe = (!state?.ok && state?.fieldErrors) || {};
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="id" value={product?.id ?? ""} />
      <Field label="Product name" htmlFor="title" error={fe.title}>
        <input id="title" name="title" className={inputCls} defaultValue={product?.title ?? ""} maxLength={80} required placeholder="e.g. Rope tug toy, large" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <Field label="Price" htmlFor="price" error={fe.price} hint="Shown on the price tag. Shoppers pay the price on your payment page.">
          <input id="price" name="price" className={inputCls} inputMode="decimal" defaultValue={product?.price ?? ""} required placeholder="24.90" />
        </Field>
        <Field label="Currency" htmlFor="currency" error={fe.currency}>
          <select id="currency" name="currency" className={inputCls} defaultValue={product?.currency ?? defaultCurrency}>
            <option value="EUR">EUR €</option>
            <option value="USD">USD $</option>
          </select>
        </Field>
      </div>
      <Field label="Description" htmlFor="description" error={fe.description}>
        <textarea id="description" name="description" className={inputCls} defaultValue={product?.description ?? ""} maxLength={1000} rows={4} placeholder="What it is, sizes, materials, shipping…" />
      </Field>
      <PaymentLinkField
        name="paymentUrl"
        defaultValue={product?.payment_url}
        error={fe.paymentUrl}
        hint={hasDefaultLink ? "Optional: without one, the Buy button uses your default payment link." : "Where shoppers pay. Without a link the product shows, but there's no Buy button."}
      />
      <label className="flex items-start gap-3 rounded-xl bg-sand/60 p-3 ring-1 ring-line">
        <input type="checkbox" name="publish" defaultChecked={product ? product.status === "published" : true} className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" />
        <span className="text-sm">
          <b>Show on my shelves</b>
          <span className="block text-ink-soft">Untick to keep it as a draft that shoppers don&apos;t see.</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Submit>{product ? "Save product" : "Add product"}</Submit>
        <Result state={state} />
      </div>
    </form>
  );
}

/** One-click row action (publish, move, delete) with an optional confirm step. */
export function RowAction({ action, fields, children, confirm, className = "btn-ghost" }: { action: Action; fields: Record<string, string>; children: React.ReactNode; confirm?: string; className?: string }) {
  const [state, run] = useActionState(action, null);
  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="inline"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Submit className={className} pendingText="…">
        {children}
      </Submit>
      {state && !state.ok && <span className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}

export { PAYMENT_LINK_PROVIDERS };

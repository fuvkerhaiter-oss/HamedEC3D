/** Validation of what tenants submit from their dashboard (FormData → typed input). Prices: integer minor units. */
import { z } from "zod";
import { bool, optStr, str } from "../admin/form";
import { fromDecimalString } from "../money";
import { checkPaymentLink } from "./payment-links";

const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Optional payment link: blank → null; otherwise must pass checkPaymentLink (normalised). */
export const optPaymentLink = (ownHosts: readonly string[]) =>
  z.preprocess(blankToUndef, z.string().optional()).transform((v, ctx) => {
    if (v === undefined) return null;
    const c = checkPaymentLink(v, ownHosts);
    if (!c.ok) {
      ctx.addIssue({ code: "custom", message: c.error });
      return z.NEVER;
    }
    return c.url;
  });

const handle = z.preprocess(
  blankToUndef,
  z
    .string()
    .trim()
    .transform((s) => s.replace(/^https?:\/\/(www\.)?(instagram\.com|tiktok\.com)\//i, "").replace(/^@/, "").replace(/\/.*$/, ""))
    .pipe(z.string().regex(/^[A-Za-z0-9._]{1,40}$/, "Just the handle, e.g. mybrand"))
    .optional(),
).transform((v) => v ?? null);

const optUrl = z.preprocess(blankToUndef, z.string().trim().max(300).optional()).transform((v, ctx) => {
  if (v === undefined) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    return u.toString();
  } catch {
    ctx.addIssue({ code: "custom", message: "Enter a web address like mybrand.com" });
    return z.NEVER;
  }
});

export const ProfileInput = (ownHosts: readonly string[]) =>
  z.object({
    brandName: z.string().trim().min(2, "At least 2 characters").max(60),
    tagline: optStr(90),
    about: optStr(1500),
    accentColor: z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, "Pick a colour"),
    website: optUrl,
    instagram: handle,
    tiktok: handle,
    contactEmail: z.preprocess(blankToUndef, z.string().trim().toLowerCase().email("Enter a valid email").max(254).optional()).transform((v) => v ?? null),
    contactPhone: optStr(40),
    defaultPaymentUrl: optPaymentLink(ownHosts),
    signName: z.string().trim().min(2, "At least 2 characters").max(40),
  });
export type ProfileInput = z.infer<ReturnType<typeof ProfileInput>>;

/** "12.50" / "12,50" → 1250 (EUR and USD both have 2 decimals). */
const price = z
  .string()
  .trim()
  .min(1, "Enter a price")
  .transform((v, ctx) => {
    try {
      const m = fromDecimalString(v.replace(",", "."), "EUR");
      if (m.amount < 0 || m.amount > 100_000_000) throw new Error();
      return m.amount;
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a price like 24.90" });
      return z.NEVER;
    }
  });

export const ProductInput = (ownHosts: readonly string[]) =>
  z.object({
    title: z.string().trim().min(2, "At least 2 characters").max(80),
    description: optStr(1000),
    price,
    currency: z.enum(["EUR", "USD"]),
    paymentUrl: optPaymentLink(ownHosts),
    publish: bool,
  });
export type ProductInput = z.infer<ReturnType<typeof ProductInput>>;

export const idStr = str(64);

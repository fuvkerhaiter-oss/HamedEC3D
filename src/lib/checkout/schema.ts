import { z } from "zod";
import { MAX_CART_LINES } from "../cart/pricing";

const lines = z.array(z.object({ variantId: z.string().min(1).max(100), quantity: z.number().int().min(1).max(99) })).min(1).max(MAX_CART_LINES);
const country = z.string().trim().length(2).transform((s) => s.toUpperCase());
const opt = (max: number) => z.string().trim().max(max).optional().transform((s) => s || undefined);

export const QuoteBody = z.object({
  lines,
  country,
  region: opt(60),
  couponCode: opt(40),
  shippingMethodId: z.string().max(100).nullish(),
});

export const CheckoutBody = z.object({
  lines,
  email: z.string().trim().toLowerCase().email().max(254),
  shipTo: z.object({
    fullName: z.string().trim().min(2).max(120),
    line1: z.string().trim().min(3).max(200),
    line2: opt(200),
    city: z.string().trim().min(1).max(100),
    region: opt(60),
    postalCode: z.string().trim().min(2).max(20),
    country,
    phone: opt(40),
  }),
  shippingMethodId: z.string().min(1).max(100),
  couponCode: opt(40),
  customerNote: opt(1000),
  /** Generated once per cart by the browser: resubmitting the same cart never creates a second order. */
  idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{16,80}$/),
  acceptTerms: z.literal(true),
});

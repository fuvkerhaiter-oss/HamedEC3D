import { z } from "zod";
import { isShopId } from "./availability";

export const RENTAL_CATEGORIES = [
  "Fashion & clothing",
  "Beauty & personal care",
  "Electronics & gadgets",
  "Home & living",
  "Food & drinks",
  "Pets",
  "Toys & kids",
  "Sports & outdoors",
  "Art, crafts & gifts",
  "Other",
] as const;

const opt = (max: number) => z.string().trim().max(max).optional().transform((s) => s || undefined);
const plan = z.enum(["monthly", "quarterly", "yearly"]);
const currency = z.enum(["USD", "EUR"]);
const accept = z.literal(true, { error: "Please accept the shop rental terms." });

/** New booking. Unknown keys (a client-sent price) are stripped: every amount is computed on the server. */
export const RentalBookingBody = z.object({
  shopId: z.string().refine(isShopId, "Unknown shop"),
  plan,
  currency,
  brandName: z.string().trim().min(2, "Brand name: at least 2 characters").max(60),
  contactName: z.string().trim().min(2, "Your name: at least 2 characters").max(120),
  email: z.string().trim().toLowerCase().email("Please enter a valid email").max(254),
  phone: opt(40),
  website: opt(300).refine((v) => !v || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), "Website must start with https://"),
  category: z.enum(RENTAL_CATEGORIES),
  description: z.string().trim().min(20, "Tell us a little more about your brand (20+ characters)").max(1500),
  country: z.string().trim().length(2).transform((s) => s.toUpperCase()).refine((s) => /^[A-Z]{2}$/.test(s), "Country"),
  companyName: opt(160),
  vatId: opt(40),
  acceptTerms: accept,
});

/** Renewal by the current tenant (signed lease link). Brand and contact details are carried over. */
export const RentalRenewBody = z.object({
  renewLeaseId: z.string().uuid(),
  token: z.string().min(10).max(100),
  plan,
  currency,
  acceptTerms: accept,
});

export type RentalBooking = z.infer<typeof RentalBookingBody>;

/** Longest free rental a super admin can give in one go. */
export const COMPLIMENTARY_MAX_MONTHS = 12;

/** Super admin "Give a free rental" form (/admin/rentals). Unknown keys (an amount, a price) are stripped: it is always free. */
export const ComplimentaryGrantInput = z.object({
  shopId: z.string().refine(isShopId, "Unknown shop"),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  months: z.coerce.number().int("Whole number").min(1, "At least 1 month").max(COMPLIMENTARY_MAX_MONTHS, `At most ${COMPLIMENTARY_MAX_MONTHS} months`),
  currency,
  brandName: z.string().trim().min(2, "At least 2 characters").max(60),
  contactName: z.string().trim().min(2, "At least 2 characters").max(120),
  country: z.string().trim().length(2, "2 letters").transform((s) => s.toUpperCase()).refine((s) => /^[A-Z]{2}$/.test(s), "2 letters"),
  note: z.string().trim().max(500).optional().transform((s) => s || null),
});
export type ComplimentaryGrantForm = z.infer<typeof ComplimentaryGrantInput>;

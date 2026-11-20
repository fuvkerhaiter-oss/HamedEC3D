/** zod helpers for FormData coming from admin forms. */
import { z } from "zod";
import { fromDecimalString, type CurrencyCode } from "../money";

const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const str = (max = 200) => z.string().trim().max(max);
export const reqStr = (max = 200) => z.string().trim().min(1, "Required").max(max);
export const optStr = (max = 200) => z.preprocess(blankToUndef, z.string().trim().max(max).optional()).transform((v) => v ?? null);
export const uuid = z.string().uuid("Invalid id");
export const optUuid = z.preprocess(blankToUndef, z.string().uuid().optional()).transform((v) => v ?? null);
export const bool = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
export const optInt = (min = 0, max = 1_000_000_000) =>
  z.preprocess(blankToUndef, z.coerce.number().int("Whole number").min(min).max(max).optional()).transform((v) => v ?? null);
export const int = (min = 0, max = 1_000_000_000) => z.coerce.number().int("Whole number").min(min).max(max);
export const currency = z.enum(["EUR", "USD"]);
export const ids = z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.string().uuid()).max(500));
export const strList = z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.string().max(100)).max(200));

/** Decimal money input ("12.50") → integer minor units; blank → null. */
export const optMoney = (cur: CurrencyCode) =>
  z.preprocess(blankToUndef, z.string().optional()).transform((v, ctx) => {
    if (v === undefined) return null;
    try {
      const m = fromDecimalString(v.replace(",", "."), cur);
      if (m.amount < 0) throw new Error();
      return m.amount;
    } catch {
      ctx.addIssue({ code: "custom", message: `Enter an amount like 12.50` });
      return z.NEVER;
    }
  });
export const money = (cur: CurrencyCode) => optMoney(cur).refine((v) => v !== null, "Required").transform((v) => v as number);

/** Money with currency chosen in another field: parse as a 2-decimal amount (EUR/USD share exponent 2). */
export const optMoneyAny = optMoney("EUR");

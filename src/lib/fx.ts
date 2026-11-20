/**
 * Currency conversion with exact decimal rates (numeric(18,8) strings from the DB) and integer minor units.
 * Historical orders keep their own fx snapshot; these helpers never rewrite stored amounts.
 */
import { CURRENCY_EXPONENT, type CurrencyCode } from "./money";

const SCALE = 100_000_000n; // 8 decimal places

/** Parse "1.0825" into a bigint scaled by 1e8. Rejects negatives, zero and > 8 decimals. */
export function parseRate(rate: string | number): bigint {
  const s = typeof rate === "number" ? rate.toFixed(8) : rate.trim();
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(s);
  if (!m) throw new Error(`Invalid exchange rate "${rate}"`);
  const v = BigInt(m[1]!) * SCALE + BigInt((m[2] ?? "").padEnd(8, "0") || "0");
  if (v <= 0n) throw new Error("Exchange rate must be positive");
  return v;
}

/** Convert minor units from → to, where 1 `from` = rate `to`. Rounds half away from zero. */
export function convertMinor(amount: number, from: CurrencyCode, to: CurrencyCode, rate: string | number): number {
  if (!Number.isSafeInteger(amount)) throw new Error("amount must be a safe integer");
  if (from === to) return amount;
  const r = parseRate(rate);
  const expDiff = CURRENCY_EXPONENT[to] - CURRENCY_EXPONENT[from];
  let num = BigInt(amount) * r;
  let den = SCALE;
  if (expDiff > 0) num *= 10n ** BigInt(expDiff);
  else if (expDiff < 0) den *= 10n ** BigInt(-expDiff);
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = (abs * 2n + den) / (2n * den);
  const out = Number(neg ? -q : q);
  if (!Number.isSafeInteger(out)) throw new Error("conversion overflow");
  return out;
}

/** Invert a rate string (for EUR→USD stored, USD→EUR needed). 8-decimal precision. */
export function invertRate(rate: string | number): string {
  const r = parseRate(rate);
  const inv = (SCALE * SCALE * 2n + r) / (2n * r);
  const whole = inv / SCALE;
  const frac = (inv % SCALE).toString().padStart(8, "0");
  return `${whole}.${frac}`;
}

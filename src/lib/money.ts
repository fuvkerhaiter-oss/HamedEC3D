/**
 * Integer minor-unit money. Never use floats for financial math.
 * Amounts are safe integers in the currency's minor unit (e.g. cents, millimes).
 */

/** ISO 4217 minor-unit exponents for supported currencies. */
export const CURRENCY_EXPONENT = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  TND: 3,
  JPY: 0,
} as const;

export type CurrencyCode = keyof typeof CURRENCY_EXPONENT;

export interface Money {
  readonly amount: number; // integer minor units
  readonly currency: CurrencyCode;
}

export class MoneyError extends Error {
  override name = "MoneyError";
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENT, value);
}

function assertInt(n: number, label: string): void {
  if (!Number.isSafeInteger(n)) throw new MoneyError(`${label} must be a safe integer, got ${n}`);
}

export function money(amount: number, currency: CurrencyCode): Money {
  assertInt(amount, "amount");
  if (!isCurrencyCode(currency)) throw new MoneyError(`Unsupported currency ${String(currency)}`);
  return Object.freeze({ amount, currency });
}

export const zero = (currency: CurrencyCode): Money => money(0, currency);

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function multiply(a: Money, quantity: number): Money {
  assertInt(quantity, "quantity");
  return money(a.amount * quantity, a.currency);
}

export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

export const minMoney = (a: Money, b: Money): Money => {
  assertSameCurrency(a, b);
  return a.amount <= b.amount ? a : b;
};

/**
 * Apply a rate in basis points (1 bp = 0.01%) with round-half-up integer math.
 * e.g. 1500 bp = 15%.
 */
export function percentOf(a: Money, basisPoints: number): Money {
  assertInt(basisPoints, "basisPoints");
  if (basisPoints < 0) throw new MoneyError("basisPoints must be >= 0");
  const product = a.amount * basisPoints;
  assertInt(product, "intermediate product");
  const sign = product < 0 ? -1 : 1;
  return money(sign * Math.floor((Math.abs(product) + 5000) / 10000), a.currency);
}

/** Convert integer minor units to an exact decimal string, e.g. 12345 USD -> "123.45". */
export function toDecimalString(m: Money): string {
  const exp = CURRENCY_EXPONENT[m.currency];
  const neg = m.amount < 0;
  const digits = Math.abs(m.amount).toString().padStart(exp + 1, "0");
  const whole = exp === 0 ? digits : digits.slice(0, -exp);
  const frac = exp === 0 ? "" : `.${digits.slice(-exp)}`;
  return `${neg ? "-" : ""}${whole}${frac}`;
}

/** Parse an exact decimal string ("19.99") into minor units. Rejects excess precision. */
export function fromDecimalString(value: string, currency: CurrencyCode): Money {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new MoneyError(`Invalid decimal amount "${value}"`);
  const [, neg, whole, frac = ""] = match;
  const exp = CURRENCY_EXPONENT[currency];
  if (frac.length > exp) throw new MoneyError(`Too many decimals for ${currency}: "${value}"`);
  const minor = Number(`${whole}${frac.padEnd(exp, "0")}`);
  return money(neg ? -minor : minor, currency);
}

/** Locale display only. Uses the exact decimal string, never float division. */
export function formatMoney(m: Money, locale = "en-US"): string {
  const exp = CURRENCY_EXPONENT[m.currency];
  const fmt = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  });
  // Intl accepts exact decimal strings (Intl.NumberFormat v3).
  return fmt.format(toDecimalString(m) as unknown as number);
}

/**
 * Sales markets: Italy + rest of the EU (EUR) and the USA (USD).
 * EU consumer prices are stored and shown VAT-inclusive; US prices are tax-exclusive.
 * Tax RATES are not hardcoded: they live in the `tax_rates` table and must be confirmed
 * by the business's accountant (EU OSS rules, US state nexus) or replaced by Stripe Tax.
 */
import type { CurrencyCode } from "./money";

export type MarketId = "EU" | "US";
export type TaxMode = "inclusive" | "exclusive";

export interface Market {
  id: MarketId;
  currency: CurrencyCode;
  taxMode: TaxMode;
  locale: string;
}

export const MARKETS: Readonly<Record<MarketId, Market>> = {
  EU: { id: "EU", currency: "EUR", taxMode: "inclusive", locale: "it-IT" },
  US: { id: "US", currency: "USD", taxMode: "exclusive", locale: "en-US" },
};

/** EU-27 member states (ISO 3166-1 alpha-2). */
export const EU_COUNTRIES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

export const HOME_COUNTRY = "IT";

/** Market for a shipping destination, or null if we don't ship there. */
export function marketForCountry(countryCode: string): Market | null {
  const cc = countryCode.toUpperCase();
  if (EU_COUNTRIES.has(cc)) return MARKETS.EU;
  if (cc === "US") return MARKETS.US;
  return null;
}

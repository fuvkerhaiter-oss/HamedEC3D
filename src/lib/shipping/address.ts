/**
 * Address rules shared by the checkout form and the server (the server is authoritative).
 * Deliberately conservative: US needs a valid state + ZIP (sales tax depends on the state); other
 * countries get a generic postal-code shape check only — no invented country-specific formats.
 */
export const US_STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

export interface AddressFields {
  country: string;
  region?: string | null;
  postalCode: string;
}

/** null when OK, otherwise a customer-facing message. */
export function addressProblem(a: AddressFields): string | null {
  const country = a.country.toUpperCase();
  const postal = a.postalCode.trim();
  if (country === "US") {
    if (!a.region || !US_STATES.includes(a.region.toUpperCase())) return "Choose a US state";
    if (!/^\d{5}(-\d{4})?$/.test(postal)) return "Enter a valid US ZIP code (e.g. 10001 or 10001-1234)";
    return null;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(postal)) return "Enter a valid postal code";
  return null;
}

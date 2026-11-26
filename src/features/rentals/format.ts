import { CURRENCY_EXPONENT, type CurrencyCode } from "@/lib/money";
import type { DoorStyle } from "@/lib/rentals/door-style";

/** "$20", "$12.50", "€150": whole amounts without ".00" (prices on the rental page). */
export function fmtPrice(amount: number, currency: CurrencyCode): string {
  const exp = CURRENCY_EXPONENT[currency];
  const value = amount / 10 ** exp;
  const whole = amount % 10 ** exp === 0;
  return new Intl.NumberFormat(currency === "EUR" ? "en-IE" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : exp,
    maximumFractionDigits: exp,
  }).format(value);
}

export function fmtDay(iso: string | Date | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** "North wall of the main hall" / "South wall of the new hall". */
export function shopWhere(u: { side: "N" | "S"; wall: "main" | "hall" }): string {
  return `${u.side === "N" ? "North" : "South"} wall of the ${u.wall === "hall" ? "new" : "main"} hall`;
}

/** Shop data the public pages and the 3D store share (dates as ISO strings: safe to pass to client components). */
export interface PublicShop {
  id: string;
  label: string;
  /** Where it is, e.g. "North wall of the main hall". */
  where: string;
  widthM: number;
  depthM: number;
  state: "available" | "held" | "rented";
  until: string | null;
  brand: string | null;
  /** The tenant's open storefront (brand + published products), when the shop is rented and opened by them. */
  storefront: PublicStorefront | null;
  /** The tenant's door frame colour + lighting while rented (null = the default look). */
  door: DoorStyle | null;
}

export interface PublicTenantProduct {
  id: string;
  title: string;
  description: string | null;
  /** Integer minor units. */
  price: number;
  currency: CurrencyCode;
  imageUrl: string | null;
  /** Host the Buy button goes to ("buy.stripe.com"); null = no payment link yet. */
  buyHost: string | null;
}

export interface PublicStorefront {
  tenantId: string;
  brand: string;
  tagline: string | null;
  about: string | null;
  /** #rrggbb */
  accent: string;
  logoUrl: string | null;
  website: string | null;
  instagram: string | null;
  products: PublicTenantProduct[];
}

/**
 * Legal launch gate (pure, unit tested). Production checkout refuses orders while the published legal pages still
 * contain template text or the seller identity (Settings → Seller details) is missing or looks like a placeholder.
 * Deliberately broad: a false "not ready" costs a minute of editing; a false "ready" means selling under a
 * placeholder identity. Nothing here decides legal content; it only refuses obviously unfinished text.
 */

export interface LegalPageText {
  slug: string;
  body: string;
}

export interface SellerIdentity {
  legalName?: unknown;
  address?: unknown;
  vatNumber?: unknown;
  email?: unknown;
}

/** Signals that text is still a template. Each one is a reason to block, never a reason to auto-fill. */
const PLACEHOLDER_PATTERNS: [RegExp, string][] = [
  [/\[[^\]\n]*[A-Za-z][^\]\n]*\]/, "a [bracketed] placeholder"],
  [/\{\{[^}]*\}\}/, "a {{template}} variable"],
  [/<\s*(?:insert|your|company|name|address|vat|todo)[^>]*>/i, "an <insert …> placeholder"],
  [/^\s*TEMPLATE\b/m, "the TEMPLATE banner"],
  [/\bCHOOSE (?:ONE|AND EXPLAIN)\b/, "an unmade \"choose one\" decision"],
  [/\b(?:TODO|TBD|FIXME)\b/, "a TODO/TBD note"],
  [/\blorem ipsum\b/i, "lorem ipsum filler"],
  [/\bX{3,}\b/, "an XXX placeholder"],
  [/\b(?:PLACEHOLDER|INSERT (?:HERE|NAME|ADDRESS))\b/i, "the word PLACEHOLDER"],
  [/\b(?:your company(?: name)?|company name here|acme (?:inc|ltd|corp))\b/i, "a sample company name"],
  [/@example\.(?:com|org|net)\b/i, "an example.com email"],
];

/** First placeholder signal found in `text`, or null when none. */
export function placeholderSignal(text: string): string | null {
  for (const [re, label] of PLACEHOLDER_PATTERNS) {
    const m = text.match(re);
    if (m) return `${label} ("${m[0].slice(0, 40)}")`;
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Problems with the seller identity shown on invoices and legal pages. Empty = looks complete. */
export function sellerIdentityProblems(seller: SellerIdentity | null | undefined): string[] {
  const s = seller ?? {};
  const out: string[] = [];
  const name = str(s.legalName);
  const address = str(s.address);
  const vat = str(s.vatNumber).replace(/[\s.-]/g, "");
  const email = str(s.email);
  if (name.length < 2) out.push("seller legal name is missing");
  else if (placeholderSignal(name)) out.push("seller legal name looks like a placeholder");
  if (address.length < 10) out.push("seller registered address is missing or too short");
  else if (placeholderSignal(address)) out.push("seller address looks like a placeholder");
  if (!vat) out.push("seller VAT / tax number is missing");
  else if (placeholderSignal(str(s.vatNumber)) || !/^[A-Z0-9]{6,20}$/i.test(vat) || !/\d{4,}/.test(vat) || /^(\d)\1+$/.test(vat.replace(/^[A-Z]{2}/i, ""))) {
    out.push("seller VAT / tax number does not look like a real number");
  }
  if (email && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || placeholderSignal(email))) out.push("seller email looks invalid");
  return out;
}

/** Problems in the published legal pages. `required` lists slugs that must exist. Empty = no obvious gaps. */
export function legalPageProblems(pages: readonly LegalPageText[], required: readonly string[]): string[] {
  const out: string[] = [];
  const bySlug = new Map(pages.map((p) => [p.slug, p.body ?? ""]));
  for (const slug of required) {
    const body = bySlug.get(slug);
    if (body === undefined) {
      out.push(`${slug} page is not published`);
      continue;
    }
    if (body.trim().length < 400) {
      out.push(`${slug} page is too short to be a real policy`);
      continue;
    }
    const sig = placeholderSignal(body);
    if (sig) out.push(`${slug} page still contains ${sig}`);
  }
  return out;
}

/** Combined launch check; the seller identity is also checked to appear in the terms page when both exist. */
export function legalReadiness(
  pages: readonly LegalPageText[],
  seller: SellerIdentity | null | undefined,
  required: readonly string[],
): string[] {
  const problems = [...legalPageProblems(pages, required), ...sellerIdentityProblems(seller)];
  const terms = pages.find((p) => p.slug === "terms")?.body ?? "";
  const name = str(seller?.legalName);
  if (terms && name.length >= 2 && !problems.length && !terms.toLowerCase().includes(name.toLowerCase())) {
    problems.push("terms page does not name the seller's legal name");
  }
  return problems;
}

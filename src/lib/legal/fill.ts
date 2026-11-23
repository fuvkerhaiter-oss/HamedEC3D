/**
 * Pre-fills the legal templates with facts the shop already knows (Settings → Seller details, SUPPORT_EMAIL,
 * NEXT_PUBLIC_SITE_URL). Only exact placeholders are replaced and only when a value exists; business choices
 * like "[You pay / We pay]" are never decided here and stay for the owner.
 */
export interface LegalFacts {
  legalName?: string | null;
  vatNumber?: string | null;
  address?: string | null;
  supportEmail?: string | null;
  domain?: string | null;
}

export function legalFactsFromEnv(seller: Record<string, unknown>, env: Partial<NodeJS.ProcessEnv> = process.env): LegalFacts {
  const s = (k: string) => (typeof seller[k] === "string" && (seller[k] as string).trim() ? (seller[k] as string).trim() : null);
  let domain: string | null = null;
  try {
    domain = env.NEXT_PUBLIC_SITE_URL ? new URL(env.NEXT_PUBLIC_SITE_URL).host : null;
  } catch { /* invalid URL → leave placeholder */ }
  return {
    legalName: s("legalName"),
    vatNumber: s("vatNumber"),
    address: s("address")?.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(", ") ?? null,
    supportEmail: (env.SUPPORT_EMAIL ?? "").trim() || s("email"),
    domain,
  };
}

export function fillLegalPlaceholders(body: string, f: LegalFacts): string {
  const map: [string, string | null | undefined][] = [
    ["[LEGAL COMPANY NAME]", f.legalName],
    ["[VAT NUMBER]", f.vatNumber],
    ["[REGISTERED ADDRESS]", f.address],
    ["[SUPPORT EMAIL]", f.supportEmail],
    ["[PRIVACY EMAIL]", f.supportEmail],
    ["[RETURNS EMAIL]", f.supportEmail],
    ["[WEBSITE DOMAIN]", f.domain],
  ];
  let out = body;
  for (const [ph, v] of map) if (v) out = out.split(ph).join(v);
  return out;
}

/** Placeholders still to fill: "[UPPERCASE …]" or "[a / b]" choices. Ignores "[ ]" blanks in the model form. */
export function countPlaceholders(body: string): number {
  return (body.match(/\[[^\]\n]*[A-Za-z][^\]\n]*\]/g) ?? []).length;
}

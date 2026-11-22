/**
 * "Who supported us from the beginning": the supporters wall shown in the 3D store (right panel of the updates
 * board at the chained wing). Stored as store_settings key `storefront.supporters` (publicly readable like every
 * `storefront.*` key), edited by super admins in /admin/supporters. Pure module: safe for client and server.
 */
export const SUPPORTERS_KEY = "storefront.supporters";
export const DEFAULT_SUPPORTERS_TITLE = "Who supported us from the beginning";
export const MAX_SUPPORTERS = 2000;
export const MAX_NAME = 60;

export interface Supporter {
  name: string;
  /** ISO 3166-1 alpha-2, upper case ("IT"), or "" when unknown. */
  country: string;
}

export interface SupportersWall {
  title: string;
  people: Supporter[];
}

export const EMPTY_SUPPORTERS: SupportersWall = { title: DEFAULT_SUPPORTERS_TITLE, people: [] };

/** ISO 3166-1 alpha-2 codes (officially assigned + XK Kosovo). Names come from Intl.DisplayNames. */
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO " +
  "JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR " +
  "MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO " +
  "RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV " +
  "TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");
const CODE_SET = new Set(COUNTRY_CODES);

let names: Intl.DisplayNames | null | undefined;
/** English country name for a code ("IT" → "Italy"); the code itself when the runtime has no names. */
export function countryName(code: string): string {
  if (!code) return "";
  if (names === undefined) names = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Countries sorted by English name, for pickers. */
export function countryOptions(): { code: string; name: string }[] {
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Code from a code or an English name ("it", "Italy", "United States" → "IT"/"US"); "" when unknown. */
export function toCountryCode(v: string): string {
  const s = v.trim();
  if (!s) return "";
  const up = s.toUpperCase();
  if (up.length === 2 && CODE_SET.has(up)) return up;
  if (up === "UK") return "GB";
  if (up === "USA") return "US";
  const low = s.toLowerCase();
  return COUNTRY_CODES.find((c) => countryName(c).toLowerCase() === low) ?? "";
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Validates anything (DB value, form JSON) into a safe wall: trimmed names, known codes, no blanks, capped. */
export function normalizeSupporters(v: unknown): SupportersWall {
  const o = (v && typeof v === "object" ? v : {}) as { title?: unknown; people?: unknown };
  const title = clean(o.title, 80) || DEFAULT_SUPPORTERS_TITLE;
  const people: Supporter[] = [];
  if (Array.isArray(o.people)) {
    for (const p of o.people) {
      const r = (p && typeof p === "object" ? p : {}) as { name?: unknown; country?: unknown };
      const name = clean(r.name, MAX_NAME);
      if (!name) continue;
      const cc = clean(r.country, 2).toUpperCase();
      people.push({ name, country: CODE_SET.has(cc) ? cc : "" });
      if (people.length >= MAX_SUPPORTERS) break;
    }
  }
  return { title, people };
}

/**
 * Bulk paste: one supporter per line, "Name, Country" / "Name - IT" / "Name<TAB>Italy" / just "Name".
 * The country is the part after the last separator when it is a known code or name.
 */
export function parseSupporterLines(text: string): Supporter[] {
  const out: Supporter[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.*?)\s*(?:\t|,|;|\s-\s|\|)\s*([^,;\t|]+)$/);
    const code = m ? toCountryCode(m[2]!) : "";
    const name = clean(code ? m![1] : line, MAX_NAME);
    if (name) out.push({ name, country: code });
  }
  return out;
}

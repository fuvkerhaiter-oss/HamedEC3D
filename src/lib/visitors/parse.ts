/**
 * Visitor log helpers: device / OS / browser from the user agent, geo from the hosting platform's headers,
 * path and referrer cleaning. Pure (no I/O), shared by /api/visit and the tests.
 */
import { createHash } from "node:crypto";

export type DeviceType = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

export interface ParsedAgent {
  device: DeviceType;
  os: string | null;
  browser: string | null;
  isBot: boolean;
}

const BOT_RE =
  /bot\b|bot\/|crawl|spider|slurp|bingpreview|facebookexternalhit|meta-externalagent|embedly|whatsapp|telegram|discord|skype|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl\/|wget|python-|httpx|axios|node-fetch|undici|go-http|java\/|okhttp|libwww|phantomjs|selenium|puppeteer|playwright|scrapy|ahrefs|semrush|mj12|petal|yandex|baidu|bytespider|gptbot|claudebot|perplexity|ccbot/i;

const major = (ua: string, re: RegExp) => ua.match(re)?.[1]?.split(".")[0] ?? null;

/** Best-effort, dependency-free user-agent parser. Client hints (sec-ch-ua-*) win where the browser sends them. */
export function parseUserAgent(ua: string | null | undefined, hints: { mobile?: string | null; platform?: string | null; touchPoints?: number | null } = {}): ParsedAgent {
  const s = (ua ?? "").slice(0, 400);
  if (!s) return { device: "unknown", os: null, browser: null, isBot: false };
  if (BOT_RE.test(s)) return { device: "bot", os: null, browser: botName(s), isBot: true };

  let os: string | null = null;
  let v: string | null;
  if (/iPhone|iPod/.test(s)) os = (v = major(s, /OS (\d+)[_.]/)) ? `iOS ${v}` : "iOS";
  else if (/iPad/.test(s)) os = (v = major(s, /OS (\d+)[_.]/)) ? `iPadOS ${v}` : "iPadOS";
  else if (/Android/.test(s)) os = (v = major(s, /Android (\d+)/)) ? `Android ${v}` : "Android";
  else if (/CrOS/.test(s)) os = "ChromeOS";
  else if (/Windows NT/.test(s)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(s)) os = "macOS";
  else if (/Linux/.test(s)) os = "Linux";
  const hintPlatform = hints.platform?.replace(/"/g, "").trim();
  if (!os && hintPlatform) os = hintPlatform.slice(0, 40);

  let browser: string | null = null;
  if ((v = major(s, /Edg(?:e|A|iOS)?\/([\d.]+)/))) browser = `Edge ${v}`;
  else if ((v = major(s, /(?:OPR|Opera)\/([\d.]+)/))) browser = `Opera ${v}`;
  else if ((v = major(s, /SamsungBrowser\/([\d.]+)/))) browser = `Samsung Internet ${v}`;
  else if ((v = major(s, /(?:Firefox|FxiOS)\/([\d.]+)/))) browser = `Firefox ${v}`;
  else if ((v = major(s, /CriOS\/([\d.]+)/))) browser = `Chrome ${v}`;
  else if ((v = major(s, /Chrome\/([\d.]+)/))) browser = `Chrome ${v}`;
  else if (/Safari\//.test(s)) browser = (v = major(s, /Version\/([\d.]+)/)) ? `Safari ${v}` : "Safari";

  let device: DeviceType = "desktop";
  if (/iPad|Tablet|PlayBook|Silk|Kindle/.test(s) || (/Android/.test(s) && !/Mobile/.test(s))) device = "tablet";
  else if (/Mobi|iPhone|iPod|Android|Windows Phone/.test(s) || hints.mobile === "?1") device = "mobile";
  // iPadOS 13+ sends a desktop Mac user agent; a touch screen gives it away.
  if (os === "macOS" && (hints.touchPoints ?? 0) > 1) {
    device = "tablet";
    os = "iPadOS";
  }
  return { device, os, browser, isBot: false };
}

function botName(s: string): string {
  const m = s.match(/([A-Za-z][\w.-]*(?:bot|spider|crawler))/i) ?? s.match(/^([\w.-]+)\//);
  return (m?.[1] ?? "Bot").slice(0, 40);
}

export interface Geo {
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
}

const decode = (v: string | null) => {
  if (!v) return null;
  try {
    return decodeURIComponent(v).trim().slice(0, 80) || null;
  } catch {
    return v.slice(0, 80);
  }
};

/** Country / region / city from the platform's edge headers (Vercel, Cloudflare). No outside lookup. */
export function geoFromHeaders(h: Headers): Geo {
  const raw = (h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry") ?? "").toUpperCase();
  const country = /^[A-Z]{2}$/.test(raw) && raw !== "XX" && raw !== "T1" ? raw : null;
  return {
    country,
    region: decode(h.get("x-vercel-ip-country-region") ?? h.get("cf-region")),
    city: decode(h.get("x-vercel-ip-city") ?? h.get("cf-ipcity")),
    timezone: decode(h.get("x-vercel-ip-timezone") ?? h.get("cf-timezone"))?.slice(0, 64) ?? null,
  };
}

/** Loopback / private network addresses (local development, an internal proxy). */
export function isPrivateIp(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^::ffff:/, "");
  return (
    s === "unknown" || s === "::1" || s === "localhost" ||
    /^127\./.test(s) || /^10\./.test(s) || /^192\.168\./.test(s) || /^172\.(1[6-9]|2\d|3[01])\./.test(s) || /^169\.254\./.test(s) ||
    /^f[cd][0-9a-f]{2}:/.test(s) || /^fe80:/.test(s)
  );
}

/** Paths the visitor log ignores (staff, APIs, dev tools). */
export function isTrackedPath(path: string): boolean {
  return !/^\/(admin|api|dev|_next)(\/|$)/.test(path);
}

/**
 * Only the path: the query string and hash are dropped (they can carry signed links such as
 * /rent-a-shop/lease?id&t or /orders/… tokens). Returns null for anything that isn't a site path.
 */
export function cleanPath(input: unknown): string | null {
  if (typeof input !== "string" || !input.startsWith("/") || input.startsWith("//")) return null;
  const path = input.split(/[?#]/)[0]!.replace(/\/{2,}/g, "/");
  if (!/^\/[\w\-./~%@:+]*$/.test(path)) return null;
  return path.length > 300 ? path.slice(0, 300) : path;
}

/** The referring site's host ("google.com"), or null when it is this site or not a web URL. */
export function referrerHost(input: unknown, ownHost: string | null): string | null {
  if (typeof input !== "string" || !input) return null;
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const own = (ownHost ?? "").toLowerCase().split(":")[0]!.replace(/^www\./, "");
    if (!host || host === own) return null;
    return host.slice(0, 200);
  } catch {
    return null;
  }
}

/** Same browser on the same connection → same key (returning visitor), without a cookie. */
export function visitorKey(ip: string, ua: string | null | undefined): string {
  return createHash("sha256").update(`${ip}\n${ua ?? ""}`).digest("hex");
}

/** "4 min 12 s" style duration. */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60 ? `${s % 60} s` : ""}`.trim();
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/**
 * Data minimisation for the visitor log: IPv4 keeps the first 3 octets (203.0.113.0), IPv6 the first 3 groups
 * (2001:db8:85a3::). Enough for "same network" grouping and abuse review, not enough to single out a household.
 * Visits are still matched by visitorKey (a one-way hash of the full IP + browser). VISITOR_LOG_FULL_IP=true keeps
 * full addresses (only with a documented legal basis; update the privacy policy first).
 */
export function anonymizeIp(ip: string, env: Partial<NodeJS.ProcessEnv> = process.env): string {
  if (env.VISITOR_LOG_FULL_IP === "true") return ip;
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
  if (ip.includes(":")) {
    const groups = ip.split("::")[0]!.split(":").filter(Boolean).slice(0, 3);
    return `${groups.join(":")}::`;
  }
  return "unknown";
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPath, flagEmoji, fmtDuration, geoFromHeaders, isPrivateIp, isTrackedPath, parseUserAgent, referrerHost, visitorKey } from "../../src/lib/visitors/parse";

const UA = {
  winChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.70",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  androidPhone: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  google: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  headless: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36",
};

test("parseUserAgent: devices, browsers, operating systems", () => {
  assert.deepEqual(parseUserAgent(UA.winChrome), { device: "desktop", os: "Windows", browser: "Chrome 131", isBot: false });
  assert.equal(parseUserAgent(UA.winEdge).browser, "Edge 131");
  assert.deepEqual(parseUserAgent(UA.iphone), { device: "mobile", os: "iOS 18", browser: "Safari 18", isBot: false });
  assert.deepEqual(parseUserAgent(UA.androidPhone), { device: "mobile", os: "Android 14", browser: "Chrome 131", isBot: false });
  assert.equal(parseUserAgent(UA.androidTablet).device, "tablet");
  assert.equal(parseUserAgent(UA.samsung).browser, "Samsung Internet 26");
  assert.deepEqual(parseUserAgent(UA.macSafari), { device: "desktop", os: "macOS", browser: "Safari 18", isBot: false });
  assert.deepEqual(parseUserAgent(UA.firefox), { device: "desktop", os: "Linux", browser: "Firefox 133", isBot: false });
  assert.equal(parseUserAgent(null).device, "unknown");
});

test("parseUserAgent: iPad with a desktop UA is a tablet; client hint mobile wins", () => {
  assert.deepEqual(parseUserAgent(UA.macSafari, { touchPoints: 5 }), { device: "tablet", os: "iPadOS", browser: "Safari 18", isBot: false });
  assert.equal(parseUserAgent("Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0", { mobile: "?1" }).device, "mobile");
});

test("parseUserAgent: bots and headless browsers", () => {
  const g = parseUserAgent(UA.google);
  assert.equal(g.isBot, true);
  assert.equal(g.device, "bot");
  assert.equal(g.browser, "Googlebot");
  assert.equal(parseUserAgent(UA.headless).isBot, true);
  assert.equal(parseUserAgent("curl/8.4.0").isBot, true);
});

test("geoFromHeaders: Vercel and Cloudflare headers, unknown codes dropped", () => {
  const v = geoFromHeaders(new Headers({ "x-vercel-ip-country": "IT", "x-vercel-ip-country-region": "RM", "x-vercel-ip-city": "Roma%20Capitale", "x-vercel-ip-timezone": "Europe/Rome" }));
  assert.deepEqual(v, { country: "IT", region: "RM", city: "Roma Capitale", timezone: "Europe/Rome" });
  assert.equal(geoFromHeaders(new Headers({ "cf-ipcountry": "us" })).country, "US");
  assert.equal(geoFromHeaders(new Headers({ "cf-ipcountry": "XX" })).country, null);
  assert.deepEqual(geoFromHeaders(new Headers()), { country: null, region: null, city: null, timezone: null });
});

test("cleanPath drops query strings (signed links) and rejects non-paths", () => {
  assert.equal(cleanPath("/rent-a-shop/lease?id=abc&t=secret"), "/rent-a-shop/lease");
  assert.equal(cleanPath("/store#x"), "/store");
  assert.equal(cleanPath("//evil.com/x"), null);
  assert.equal(cleanPath("https://evil.com"), null);
  assert.equal(cleanPath("/<script>"), null);
  assert.equal(cleanPath(42), null);
  assert.equal(cleanPath("/" + "a".repeat(400))!.length, 300);
});

test("isTrackedPath skips staff and API paths", () => {
  assert.equal(isTrackedPath("/store"), true);
  assert.equal(isTrackedPath("/"), true);
  assert.equal(isTrackedPath("/admin"), false);
  assert.equal(isTrackedPath("/admin/orders"), false);
  assert.equal(isTrackedPath("/api/visit"), false);
  assert.equal(isTrackedPath("/administrator-guide"), true);
});

test("referrerHost: external host only", () => {
  assert.equal(referrerHost("https://www.google.com/search?q=x", "wegoshiiip.com"), "google.com");
  assert.equal(referrerHost("https://wegoshiiip.com/catalog", "www.wegoshiiip.com"), null);
  assert.equal(referrerHost("javascript:alert(1)", "a.com"), null);
  assert.equal(referrerHost("", "a.com"), null);
});

test("misc helpers", () => {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("192.168.1.4"), true);
  assert.equal(isPrivateIp("172.20.0.1"), true);
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(visitorKey("1.2.3.4", "ua"), visitorKey("1.2.3.4", "ua"));
  assert.notEqual(visitorKey("1.2.3.4", "ua"), visitorKey("1.2.3.5", "ua"));
  assert.equal(visitorKey("1.2.3.4", "ua").length, 64);
  assert.equal(flagEmoji("IT"), "🇮🇹");
  assert.equal(flagEmoji(null), "🌐");
  assert.equal(fmtDuration(42), "42 s");
  assert.equal(fmtDuration(125), "2 min 5 s");
  assert.equal(fmtDuration(3720), "1 h 2 min");
});

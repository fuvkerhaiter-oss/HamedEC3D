/**
 * Page speed check in headless Edge on an emulated phone network (≈ fast 4G: 9 Mbit/s, 150 ms RTT, 4× slower CPU):
 * time to first byte, first/largest paint, bytes downloaded before load and in the first 10 s, JS bytes.
 * Usage: npx tsx tools/perf/measure-pages.ts [baseUrl] [path ...]   (production server must be running: next start)
 */
import { chromium, devices } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3200";
const paths = process.argv.slice(3).length ? process.argv.slice(3) : ["/", "/catalog", "/contact", "/store"];

async function measure(path: string) {
  const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? "msedge" });
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (9e6 / 8), uploadThroughput: (1.5e6 / 8) });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(base + path, { waitUntil: "load", timeout: 120_000 });
  const atLoad = await page.evaluate(`performance.getEntriesByType("resource").reduce((s, r) => s + r.transferSize, 0)`);
  await page.waitForTimeout(10_000);
  const r = (await page.evaluate(`(async () => {
    const n = performance.getEntriesByType("navigation")[0];
    const res = performance.getEntriesByType("resource");
    const lcp = await new Promise((ok) => { new PerformanceObserver((l) => { const e = l.getEntries(); ok(e[e.length - 1].startTime); }).observe({ type: "largest-contentful-paint", buffered: true }); setTimeout(() => ok(-1), 500); });
    const kb = (xs) => Math.round(xs.reduce((s, r) => s + r.transferSize, 0) / 1024);
    return {
      ttfb: Math.round(n.responseStart), fcp: Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1),
      lcp: Math.round(lcp), load: Math.round(n.loadEventEnd), htmlKB: Math.round(n.transferSize / 1024),
      jsKB: kb(res.filter((r) => r.name.endsWith(".js"))), totalKB10s: kb(res) + Math.round(n.transferSize / 1024),
    };
  })()`)) as Record<string, number>;
  await browser.close();
  return { path, ...r, loadKB: Math.round(Number(atLoad) / 1024) };
}

for (const p of paths) console.log(JSON.stringify(await measure(p)));

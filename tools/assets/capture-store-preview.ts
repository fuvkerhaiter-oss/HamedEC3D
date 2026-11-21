/**
 * Renders the REAL 3D store from the spawn point (dev-only /store?cam=… inspect camera) and saves it as the
 * homepage hero picture. Needs a running dev server. Usage:
 *   npx tsx tools/assets/capture-store-preview.ts [baseUrl] [x,y,z,yawDeg,pitchDeg]
 */
import { chromium } from "@playwright/test";
import sharp from "sharp";

const base = process.argv[2] ?? "http://localhost:3000";
const cam = process.argv[3] ?? "-9,1.75,-1.27,-90,-4";
const out = process.argv[4] ?? "src/assets/hero/store-first-view.webp";

async function main() {
  const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? "msedge", args: ["--use-angle=default", "--enable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
  await page.goto(`${base}/store?cam=${cam}`);
  await page.locator(".vsw-load").waitFor({ state: "attached", timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector(".vsw-load")?.getAttribute("aria-hidden") === "true", undefined, { timeout: 180_000 });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }); // dev overlay badge
  await page.waitForTimeout(4000); // shelf photos + environment map settle
  const png = await page.locator("canvas").first().screenshot();
  await sharp(png).resize({ width: 2000 }).webp({ quality: 84 }).toFile(out);
  console.log(`saved ${out}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

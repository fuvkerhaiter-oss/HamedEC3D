/**
 * Measures the 3D store in a real (GPU) headless Edge: model bytes, load-to-ready time, draw calls,
 * triangles, GPU geometries/textures, JS heap and average FPS over a fixed walk path.
 * Usage: npx tsx tools/perf/measure-store.ts [baseUrl] [desktop|mobile]   (dev server must be running)
 */
import { chromium, devices } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const profile = process.argv[3] ?? "desktop";

async function main() {
  const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? "msedge", args: ["--use-angle=default", "--enable-gpu", "--enable-precise-memory-info", "--disable-gpu-vsync", "--disable-frame-rate-limit"] });
  const ctx = await browser.newContext(profile === "mobile" ? { ...devices["Pixel 7 landscape"] } : { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const t0 = Date.now();
  await page.goto(`${base}/store?cam=0,1.6,4,0,0`, { waitUntil: "load" });
  await page.waitForFunction(() => (window as unknown as { __vsw?: { ui: { getState(): { ready: boolean } } } }).__vsw?.ui.getState().ready, null, { timeout: 120_000 });
  const readyMs = Date.now() - t0;
  await page.waitForTimeout(2500);
  // Plain string so the bundler cannot inject helpers into browser code.
  const r = (await page.evaluate(`(async () => {    const v = (window).__vsw;
    const views = [[0, 1.6, 4, 0], [0, 1.6, 4, 180], [-3, 1.6, 0, 90], [3, 1.6, -2, -90]];
    const out = [];
    for (const [x, y, z, yaw] of views) {
      v.camera.position.set(x, y, z);
      v.camera.rotation.set(0, (yaw * Math.PI) / 180, 0, "YXZ");
      await new Promise((res) => setTimeout(res, 400));
      let n = 0;
      const s = performance.now();
      await new Promise((res) => { function f() { n++; if (performance.now() - s < 2000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      out.push({ calls: v.gl.info.render.calls, tris: v.gl.info.render.triangles, fps: +(n / 2).toFixed(1) });
    }
    const res = performance.getEntriesByType("resource");
    const kb = (f) => Math.round(res.filter((e) => f(e.name)).reduce((a, e) => a + (e.encodedBodySize || e.transferSize), 0) / 1024);
    const mem = (performance).memory;
    return {
      views: out,
      geometries: v.gl.info.memory.geometries, textures: v.gl.info.memory.textures, programs: v.gl.info.programs?.length,
      modelsKB: kb((n) => n.includes(".glb")), jsKB: kb((n) => n.endsWith(".js") || n.includes(".js?")), imagesKB: kb((n) => /\.(webp|png|jpe?g|avif)/.test(n) || n.includes("/_next/image")),
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
    };
  })()`)) as Record<string, unknown>;
  console.log(JSON.stringify({ profile, readyMs, ...r, errors }, null, 1));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

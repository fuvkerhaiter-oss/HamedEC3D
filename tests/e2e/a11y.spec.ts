import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Automated accessibility check (axe-core, WCAG 2.0/2.1 A + AA rules) on the main shopping pages, desktop and phone.
 * Fails on "serious" and "critical" violations. Automated rules catch only part of WCAG: this is a regression guard,
 * not a compliance claim. The 3D canvas itself is out of scope (the catalog is the accessible way to shop).
 */
const PAGES = ["/", "/catalog", "/catalog/sea-salt-chips", "/checkout", "/rent-a-shop", "/contact", "/pages/terms"];

async function seriousViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

for (const viewport of [{ name: "desktop", width: 1280, height: 800 }, { name: "phone", width: 375, height: 812 }]) {
  test.describe(`accessibility (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    for (const path of PAGES) {
      test(`${path} has no serious axe violations`, async ({ page }) => {
        const res = await page.goto(path);
        test.skip(res?.status() === 404, `${path} not present in this data set`);
        await page.waitForLoadState("networkidle");
        expect(await seriousViolations(page)).toEqual([]);
      });
    }
  });
}

import { expect, test, type Page } from "@playwright/test";
import { createAdminUser } from "../../src/lib/admin/auth";
import { createSql } from "../../src/lib/db/client";
import { E2E_DB_PORT } from "../../playwright.config";

/** Test-only admin accounts, created in the fresh e2e database (never used anywhere else). */
const PASSWORD = "e2e-admin-password-42";
const SUPER = "e2e-super@megamarket.test";
const SUPPORT = "e2e-support@megamarket.test";

test.beforeAll(async () => {
  const sql = createSql(`postgres://postgres:postgres@127.0.0.1:${E2E_DB_PORT}/postgres`, 1);
  try {
    for (const [email, role] of [[SUPER, "SUPER_ADMIN"], [SUPPORT, "SUPPORT"]] as const) {
      const exists = await sql`select 1 from public.admin_users where email = ${email}`;
      if (!exists.length) await createAdminUser(sql, { email, fullName: role, password: PASSWORD, role });
    }
  } finally {
    await sql.end();
  }
});

async function signIn(page: Page, email: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("admin requires a session; storefront accounts can't reach it", async ({ page, request }) => {
  await page.goto("/admin/products");
  await expect(page).toHaveURL(/\/admin\/login/);
  expect((await request.get("/api/admin/export/orders")).status()).toBe(401);
  await page.getByLabel("Email").fill(SUPER);
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
});

test("support role is limited server-side (pages, nav and exports)", async ({ page }) => {
  await signIn(page, SUPPORT);
  const nav = page.getByRole("navigation", { name: "Admin" });
  await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Admin Users" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/admin\/forbidden\?p=settings\.manage/);
  await page.goto("/admin/products/new");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  expect((await page.request.get("/api/admin/export/products")).status()).toBe(403);
});

test("super admin creates and publishes a product; it appears in the storefront catalog", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, SUPER);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hello");

  await page.goto("/admin/products/new");
  await page.getByLabel("Name", { exact: true }).fill("E2E Dog Biscuits");
  await page.getByLabel("Category").selectOption({ label: "Snacks" });
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);

  const variant = page.locator("form").filter({ has: page.getByRole("button", { name: "Add variant" }) });
  await variant.getByLabel("SKU", { exact: true }).fill("E2E-DOG-1");
  await variant.getByLabel("Name", { exact: true }).fill("500 g");
  await variant.getByLabel("Price EUR (VAT incl.)").fill("4.99");
  await variant.getByLabel("Price USD (pre-tax)").fill("5.49");
  await variant.getByLabel("Initial stock").fill("12");
  await variant.getByRole("button", { name: "Add variant" }).click();
  await expect(page.getByRole("heading", { name: "Variants (1)" })).toBeVisible();
  await expect(page.getByText("E2E-DOG-1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("published", { exact: true }).first()).toBeVisible();

  await expect(async () => {
    await page.goto("/catalog?category=snacks");
    await expect(page.getByRole("heading", { name: "E2E Dog Biscuits" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  // Stock adjustment is logged with the reason.
  await page.goto("/admin/inventory?q=E2E-DOG-1");
  await page.getByText("Change…").click();
  await page.getByLabel("New on-hand quantity").fill("3");
  await page.getByLabel("Reason").fill("E2E recount");
  await page.getByRole("button", { name: "Set on-hand" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Stock set to 3" })).toBeVisible();
  await page.goto("/admin/activity?q=E2E");
  await expect(page.getByText("E2E-DOG-1: stock set to 3 (E2E recount)")).toBeVisible();
});

test("admin works on a phone: drawer navigation, no horizontal scroll", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await signIn(page, SUPER);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog", { name: "Admin navigation" }).getByRole("link", { name: "Inventory" }).click();
  await expect(page).toHaveURL(/\/admin\/inventory/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();
});

test("product images: upload, preview, set main, reorder, delete — catalog follows", async ({ page }) => {
  test.setTimeout(120_000);
  const sharp = (await import("sharp")).default;
  const png = (bg: string) => sharp({ create: { width: 640, height: 480, channels: 3, background: bg } }).png().toBuffer();
  await signIn(page, SUPER);
  await page.goto("/admin/products/images?q=sea-salt");
  await page.getByRole("link", { name: "Manage" }).first().click();
  await expect(page.getByRole("heading", { name: "Images (0)" })).toBeVisible();

  await page.locator('input[type="file"][multiple]').setInputFiles([
    { name: "a.png", mimeType: "image/png", buffer: await png("#ff0000") },
    { name: "b.png", mimeType: "image/png", buffer: await png("#00aa00") },
    { name: "c.png", mimeType: "image/png", buffer: await png("#0000ff") },
  ]);
  await expect(page.getByText("Ready to upload — preview before saving")).toBeVisible();
  await expect(page.getByText("640×480").first()).toBeVisible();
  await page.getByRole("button", { name: "Upload 3 images" }).click();
  await expect(page.getByRole("heading", { name: "Images (3)" })).toBeVisible({ timeout: 30_000 });
  const items = page.getByTestId("gallery-item");
  await expect(items).toHaveCount(3);
  const src = (i: number) => items.nth(i).locator("img").getAttribute("src");
  const [s0, s1, s2] = [await src(0), await src(1), await src(2)];

  await items.nth(2).getByRole("button", { name: "Set main" }).click();
  await expect.poll(() => src(0)).toBe(s2);
  await items.nth(2).getByRole("button", { name: /earlier/ }).click(); // keyboard-accessible reorder
  await page.getByRole("button", { name: "Save order" }).click();
  await expect(page.getByText("Gallery order saved.")).toBeVisible();
  await expect.poll(async () => [await src(0), await src(1), await src(2)]).toEqual([s2, s1, s0]);

  await items.nth(0).getByRole("button", { name: "Preview image 1" }).click();
  await expect(page.getByRole("dialog", { name: "Image preview" })).toBeVisible();
  await page.getByRole("dialog", { name: "Image preview" }).getByRole("button", { name: "Close" }).click();

  page.once("dialog", (d) => d.accept());
  await items.nth(2).getByRole("button", { name: "Delete image 3" }).click();
  await expect(page.getByRole("heading", { name: "Images (2)" })).toBeVisible();
  expect((await page.request.get(s0!)).status()).toBe(404); // file removed from storage

  await expect(async () => {
    await page.goto("/catalog/sea-salt-chips");
    await expect(page.locator("main img").first()).toHaveAttribute("src", s2!, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
});

test("only product editors may upload images", async ({ page }) => {
  await signIn(page, SUPPORT);
  const res = await page.request.post("/api/admin/images/bulk", {
    headers: { origin: new URL(page.url()).origin },
    multipart: { file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("x") } },
  });
  expect(res.status()).toBe(403);
  const anon = await page.context().browser()!.newContext();
  const r2 = await anon.request.post(new URL("/api/admin/images/bulk", page.url()).toString(), {
    headers: { origin: new URL(page.url()).origin },
    multipart: { file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("x") } },
  });
  expect(r2.status()).toBe(401);
  await anon.close();
});

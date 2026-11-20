import { expect, test, type Page } from "@playwright/test";

/** Collect uncaught page errors and console errors (ignoring known-noisy WebGL driver warnings). */
function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/GPU stall|GL_|WebGL: |swiftshader|Automatic fallback to software WebGL/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

test("home page links to the store and the catalog", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Mega Market");
  // Hero CTA and the closing CTA band both enter the store.
  const enter = page.getByRole("main").getByRole("link", { name: "Enter the store" });
  await expect(enter.first()).toBeVisible();
  for (const link of await enter.all()) await expect(link).toHaveAttribute("href", "/store");
  await expect(page.getByRole("link", { name: "Browse the catalog" }).first()).toHaveAttribute("href", "/catalog");
  expect(errors).toEqual([]);
});

test("catalog: add to cart is priced by the server (client sends ids + quantities only)", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/catalog");
  const addButtons = page.getByRole("button", { name: "Add to cart" });
  await expect(addButtons.first()).toBeVisible();

  await addButtons.first().click();
  await expect(page.getByRole("button", { name: /Open cart, 1 item/ }).first()).toBeVisible();

  const priceRequest = page.waitForRequest((r) => r.url().endsWith("/api/cart/price") && r.method() === "POST");
  const priceResponse = page.waitForResponse((r) => r.url().endsWith("/api/cart/price"));
  await page.getByRole("button", { name: /Open cart/ }).first().click();

  const body = (await priceRequest).postDataJSON() as { market: string; lines: Record<string, unknown>[] };
  expect(["EU", "US"]).toContain(body.market);
  for (const line of body.lines) expect(Object.keys(line).sort()).toEqual(["quantity", "variantId"]);

  const res = await priceResponse;
  expect(res.status()).toBe(200);
  const cart = (await res.json()) as { subtotal: { amount: number; currency: string }; lines: unknown[] };
  expect(cart.lines).toHaveLength(1);
  expect(Number.isInteger(cart.subtotal.amount)).toBe(true);
  expect(cart.subtotal.amount).toBeGreaterThan(0);

  const dialog = page.getByRole("dialog", { name: "Your cart" });
  await expect(dialog.getByText("Subtotal")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Checkout — coming soon/ })).toBeDisabled();
  expect(errors).toEqual([]);
});

test.describe("cart pricing API", () => {
  test("rejects malformed input", async ({ request }) => {
    const res = await request.post("/api/cart/price", { data: { market: "XX", lines: "nope" } });
    expect(res.status()).toBe(400);
  });

  test("ignores client-supplied prices and flags unknown variants", async ({ request }) => {
    const res = await request.post("/api/cart/price", {
      data: { market: "EU", lines: [{ variantId: "does-not-exist", quantity: 1, unitPrice: 1 }] },
    });
    expect(res.status()).toBe(200);
    const cart = (await res.json()) as { lines: unknown[]; issues: { variantId: string }[]; subtotal: { amount: number } };
    expect(cart.lines).toHaveLength(0);
    expect(cart.issues.map((i) => i.variantId)).toContain("does-not-exist");
    expect(cart.subtotal.amount).toBe(0);
  });
});

test("3D store loads the environment and trolley GLBs and shows the entry overlay", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  const glbs = new Map<string, number>();
  page.on("response", (r) => {
    if (r.url().endsWith(".glb")) glbs.set(new URL(r.url()).pathname, r.status());
  });

  await page.goto("/store");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Click to enter" })).toBeVisible({ timeout: 60_000 });
  // The loading shell fades out (stays mounted with aria-hidden) once the scene and GLBs are ready.
  await expect(page.locator(".vsw-load")).toHaveAttribute("aria-hidden", "true", { timeout: 60_000 });

  expect(glbs.get("/models/env/supermarket.glb")).toBe(200);
  expect(glbs.get("/models/props/trolley.glb")).toBe(200);
  expect(errors).toEqual([]);
});

test.describe("3D store on a phone (touch emulation)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("opens with touch controls: tap to enter, joystick + action buttons, pause", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackErrors(page);
    await page.goto("/store");
    const enter = page.getByRole("button", { name: "Tap to enter" });
    await expect(enter).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".vsw-load")).toHaveAttribute("aria-hidden", "true", { timeout: 60_000 });

    await enter.tap();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Level the camera" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Open cart, \d+ item/ })).toBeVisible();
    await expect(page.locator(".vsw-stick")).toBeVisible();
    // Nothing targeted at the spawn point → interact is idle.
    await expect(page.getByRole("button", { name: /Interact \(move closer/ })).toHaveAttribute("aria-disabled", "true");

    await page.getByRole("button", { name: /Open cart/ }).tap();
    await expect(page.getByRole("dialog", { name: "Your cart" })).toBeVisible();
    await page.getByRole("dialog", { name: "Your cart" }).getByRole("button", { name: "Close cart" }).last().tap();
    // Touch: closing the cart returns straight to play.
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

    await page.getByRole("button", { name: "Pause" }).tap();
    await expect(page.getByRole("button", { name: "Tap to enter" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_DB_PORT = Number(process.env.E2E_DB_PORT ?? 54340);

/**
 * E2E smoke tests against a production build (`next build` + `next start`).
 * Uses the locally installed Microsoft Edge (`channel: "msedge"`) so no browser download is needed.
 * Override with E2E_CHANNEL=chrome or E2E_CHANNEL= (bundled Chromium after `npx playwright install chromium`).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_CHANNEL ?? "msedge",
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
      },
    },
  ],
  webServer: {
    // Fresh local PostgreSQL (all migrations + seed) → build → start. See tools/db/e2e-server.ts.
    command: `npx tsx tools/db/e2e-server.ts`,
    env: { E2E_PORT: String(PORT), E2E_DB_PORT: String(E2E_DB_PORT) },
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    // Never reuse: every run gets a fresh database.
    reuseExistingServer: false,
  },
});

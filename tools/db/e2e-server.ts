/**
 * Playwright web server: fresh local PostgreSQL (migrations + seed) → `next build` → `next start`,
 * with DATABASE_URL pointing at that database. Test-only; never touches the dev or hosted DB.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startLocalDb } from "./embedded";

const port = Number(process.env.E2E_PORT ?? 3100);
const dbPort = Number(process.env.E2E_DB_PORT ?? 54340);
// One data folder per port: a Postgres left running by an interrupted run keeps its folder locked, and
// another port can then still get a truly fresh database (E2E_DB_PORT=...).
const db = await startLocalDb({ name: `e2e-${dbPort}`, port: dbPort, fresh: true });
console.log(`[e2e] database ready on ${dbPort}`);
// Product images go to a throwaway folder (local media driver; no Supabase keys in tests).
const mediaDir = mkdtempSync(path.join(os.tmpdir(), "mm-e2e-media-"));
const env = { ...process.env, DATABASE_URL: db.url, NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`, LOCAL_MEDIA_DIR: mediaDir, MEDIA_STORAGE: "local-test-only", SHOW_SAMPLE_PRODUCTS: "true", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" };
const child = spawn(`npm run build && npx next start -p ${port}`, { shell: true, stdio: "inherit", env });
let stopping = false;
const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  child.kill();
  await db.stop().catch(() => {});
  process.exit(code);
};
child.on("exit", (code) => void stop(code ?? 0));
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

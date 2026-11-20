/** npm run test:db — runs supabase/tests/*.sql against a fresh local PostgreSQL with all migrations + seed. */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { startLocalDb } from "./embedded";

const dir = path.resolve(import.meta.dirname, "..", "..", "supabase", "tests");
const db = await startLocalDb({ name: "sqltest", port: 54339, fresh: true });
let failed = false;
try {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = postgres(db.url, { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe(readFileSync(path.join(dir, f), "utf8")).simple();
      console.log(`ok   ${f}`);
    } catch (e) {
      failed = true;
      console.error(`FAIL ${f}: ${(e as Error).message}`);
    } finally {
      await sql.end();
    }
  }
} finally {
  await db.stop();
}
process.exitCode = failed ? 1 : 0;

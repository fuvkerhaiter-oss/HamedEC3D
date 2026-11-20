/** npm run db:migrate — apply pending migrations to the LOCAL database in DATABASE_URL (.env.local). Local only. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyMigrations } from "./embedded";

const env = readFileSync(path.resolve(import.meta.dirname, "..", "..", ".env.local"), "utf8");
const url = process.env.DATABASE_URL ?? /^DATABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
if (!url || !/@(127\.0\.0\.1|localhost):/.test(url)) {
  console.error("Refusing: DATABASE_URL must point to the local development database. Use `supabase db push` for Supabase.");
  process.exit(1);
}
const applied = await applyMigrations(url, { seed: false });
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Up to date.");

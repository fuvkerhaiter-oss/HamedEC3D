/**
 * Owner recovery: remove two-factor sign-in from an admin account (lost phone AND recovery codes) and sign it out
 * everywhere. Needs DATABASE_URL (environment or .env.local), i.e. database access; there is no web path for this.
 *   npm run admin:reset-mfa -- --email admin@yourdomain
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resetMfa } from "../../src/lib/admin/auth";
import { logActivity } from "../../src/lib/admin/audit";
import { createSql } from "../../src/lib/db/client";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

function envFromFile(key: string): string | undefined {
  const file = path.resolve(import.meta.dirname, "..", "..", ".env.local");
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
}

const url = process.env.DATABASE_URL ?? envFromFile("DATABASE_URL");
const email = arg("email")?.trim().toLowerCase();
if (!url || !email) {
  console.error("Usage: npm run admin:reset-mfa -- --email admin@yourdomain   (requires DATABASE_URL)");
  process.exit(1);
}
const sql = createSql(url, 1);
try {
  const [row] = await sql<{ id: string }[]>`select id from public.admin_users where lower(email) = ${email}`;
  if (!row) {
    console.error("No admin with that email.");
    process.exitCode = 1;
  } else {
    await resetMfa(sql, row.id);
    await logActivity(sql, null, { action: "admin.mfa_reset", entity: "admin_user", entityId: row.id, summary: `Two-factor removed by the owner (CLI) for ${email}` });
    console.log(`Two-factor sign-in removed for ${email}; all their sessions were signed out.`);
  }
} finally {
  await sql.end();
}

/**
 * Bootstrap or add an admin account (server-side; there is no public sign-up for admins).
 *   npm run admin:create -- --email you@example.com --name "Your Name" --role SUPER_ADMIN
 * The password is read from the ADMIN_PASSWORD env var (so it doesn't land in shell history) or prompted.
 * Uses DATABASE_URL from the environment or .env.local.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { createAdminUser } from "../../src/lib/admin/auth";
import { isAdminRole } from "../../src/lib/admin/permissions";
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
const email = arg("email");
const role = arg("role") ?? "SUPER_ADMIN";
if (!url || !email || !isAdminRole(role)) {
  console.error("Usage: npm run admin:create -- --email you@example.com [--name \"Name\"] [--role SUPER_ADMIN|ADMIN|PRODUCT_MANAGER|ORDER_MANAGER|SUPPORT]\nRequires DATABASE_URL.");
  process.exit(1);
}
let password = process.env.ADMIN_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question("Password (min 12 chars, letters + numbers): ");
  rl.close();
}
const sql = createSql(url, 1);
try {
  const user = await createAdminUser(sql, { email, fullName: arg("name") ?? "", password, role });
  console.log(`Created ${user.role} ${user.email}. Sign in at /admin/login`);
} catch (e) {
  console.error("Could not create admin:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

/**
 * Prints a ready-to-paste SQL statement that creates an admin, for the Supabase SQL editor
 * (no database connection from this machine). The password is only stored as a scrypt hash.
 *   npm run admin:sql -- --email you@example.com --name "Your Name" --role SUPER_ADMIN
 * The password is read from the ADMIN_PASSWORD env var or prompted.
 *
 * Forgotten password of an EXISTING admin (prints an UPDATE instead; also unlocks the account and signs out
 * every open session of that admin):
 *   npm run admin:sql -- --reset --email you@example.com
 */
import { createInterface } from "node:readline/promises";
import { hashPassword, passwordProblem } from "../../src/lib/admin/password";
import { isAdminRole } from "../../src/lib/admin/permissions";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const email = arg("email")?.trim().toLowerCase();
const name = (arg("name") ?? "").trim();
const role = arg("role") ?? "SUPER_ADMIN";
const reset = process.argv.includes("--reset");
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !isAdminRole(role)) {
  console.error('Usage: npm run admin:sql -- --email you@example.com [--name "Name"] [--role SUPER_ADMIN|ADMIN|PRODUCT_MANAGER|ORDER_MANAGER|SUPPORT]');
  console.error("   or: npm run admin:sql -- --reset --email you@example.com   (new password for an existing admin)");
  process.exit(1);
}
let password = process.env.ADMIN_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question("Password (min 12 chars, letters + numbers): ");
  rl.close();
}
const problem = passwordProblem(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const hash = await hashPassword(password);
console.log("\n-- Paste into Supabase → SQL Editor → Run:\n");
if (reset) {
  console.log(`with u as (
  update public.admin_users
     set password_hash = ${q(hash)}, password_changed_at = now(), failed_login_count = 0, locked_until = null, updated_at = now()
   where lower(email) = ${q(email)}
  returning id, email, role, is_active
), s as (delete from public.admin_sessions where admin_user_id in (select id from u))
select email, role, is_active from u;  -- 1 row = done; 0 rows = no admin with this email\n`);
  process.exit(0);
}
console.log(`insert into public.admin_users (email, full_name, password_hash, role)\nvalues (${q(email)}, ${q(name)}, ${q(hash)}, ${q(role)});\n`);

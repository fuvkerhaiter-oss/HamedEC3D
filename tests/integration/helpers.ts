/** Integration-test harness: a fresh real PostgreSQL per test file with all migrations + seed applied. */
import net from "node:net";
import { startLocalDb, type LocalDb } from "../../tools/db/embedded";
import { createSql, type Sql } from "../../src/lib/db/client";
import { createAdminUser } from "../../src/lib/admin/auth";
import type { Actor } from "../../src/lib/admin/audit";
import type { AdminRole } from "../../src/lib/admin/permissions";

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export interface TestDb {
  sql: Sql;
  db: LocalDb;
  close(): Promise<void>;
}

export async function startTestDb(name: string): Promise<TestDb> {
  const port = await freePort();
  const db = await startLocalDb({ name: `itest-${name}-${port}`, port, fresh: true });
  const sql = createSql(db.url, 10);
  return {
    sql,
    db,
    async close() {
      await sql.end({ timeout: 5 });
      await db.stop();
    },
  };
}

export const TEST_PASSWORD = "integration-test-pass-1";

export async function makeAdmin(sql: Sql, role: AdminRole = "SUPER_ADMIN", email = `${role.toLowerCase()}@test.local`): Promise<Actor & { role: AdminRole }> {
  const u = await createAdminUser(sql, { email, fullName: role, password: TEST_PASSWORD, role });
  return { id: u.id, email: u.email, ip: "127.0.0.1", role };
}

/** Business configuration a real store needs before taking orders (test values only). */
export async function setupCommerce(sql: Sql): Promise<{ euMethod: string; usMethod: string }> {
  await sql`insert into public.tax_rates (country, mode, basis_points, note) values ('IT', 'inclusive', 2200, 'TEST rate'), ('US', 'exclusive', 0, 'TEST rate')`;
  const [eu] = await sql<{ id: string }[]>`insert into public.shipping_zones (name, countries) values ('EU', ${["IT", "FR", "DE"]}) returning id`;
  const [us] = await sql<{ id: string }[]>`insert into public.shipping_zones (name, countries) values ('US', ${["US"]}) returning id`;
  const [em] = await sql<{ id: string }[]>`insert into public.shipping_methods (zone_id, name, rate_type, currency, fixed_amount, free_over_amount)
    values (${eu!.id}, 'Standard', 'fixed', 'EUR', 490, 5000) returning id`;
  const [um] = await sql<{ id: string }[]>`insert into public.shipping_methods (zone_id, name, rate_type, currency) values (${us!.id}, 'Ground', 'order_value', 'USD') returning id`;
  await sql`insert into public.shipping_rates (method_id, min_value, max_value, amount) values (${um!.id}, 0, 5000, 799), (${um!.id}, 5000, null, 0)`;
  return { euMethod: em!.id, usMethod: um!.id };
}

export async function variantBySku(sql: Sql, sku: string): Promise<string> {
  const [v] = await sql<{ id: string }[]>`select id from public.product_variants where sku = ${sku}`;
  if (!v) throw new Error(`no variant ${sku}`);
  return v.id;
}

export const IT_ADDRESS = { fullName: "Test Buyer", line1: "Via Test 1", city: "Milano", postalCode: "20100", country: "IT" };

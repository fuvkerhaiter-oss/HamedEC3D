import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createGuardedSql, DbTimeoutError } from "../../src/lib/db/client";
import { isDbUnreachable } from "../../src/lib/log";

const msg = (type: string, body: Buffer = Buffer.alloc(0)) => {
  const head = Buffer.alloc(5);
  head.write(type, 0);
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
};
const READY = msg("Z", Buffer.from("I"));

/**
 * A fake Postgres: accepts the login, answers the driver's setup query (array types) with no rows, then never
 * answers again — like a connection that went silently dead.
 */
async function silentServer() {
  let connections = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((s) => {
    connections++;
    sockets.add(s);
    s.on("error", () => {});
    let step = 0;
    s.on("data", () => {
      step++;
      if (step === 1) s.write(Buffer.concat([msg("R", Buffer.alloc(4)), READY])); // AuthenticationOk + ready
      if (step === 2) s.write(Buffer.concat([msg("1"), msg("2"), msg("n"), msg("C", Buffer.from("SELECT 0\0")), READY]));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `postgres://u:p@127.0.0.1:${port}/db`,
    connections: () => connections,
    close: () => { for (const s of sockets) s.destroy(); server.close(); },
  };
}

test("a query that gets no answer fails fast with DbTimeoutError and the pool is replaced", async () => {
  const srv = await silentServer();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const sql = createGuardedSql(srv.url, { queryTimeoutMs: 300, txTimeoutMs: 300, max: 1 });
    const t = Date.now();
    const err = await sql`select 1`.then(() => null, (e: unknown) => e);
    assert.ok(err instanceof DbTimeoutError, "times out instead of hanging");
    assert.ok(Date.now() - t < 2000);
    assert.equal(isDbUnreachable(err), true, "admin shows the 'can't reach the database' notice");
    const first = srv.connections();
    await assert.rejects(sql`select 2`, DbTimeoutError);
    assert.ok(srv.connections() > first, "the next query uses a fresh connection");
    await assert.rejects(sql.begin((tx) => tx`select 3`), DbTimeoutError);
  } finally {
    console.warn = warn;
    srv.close();
  }
});

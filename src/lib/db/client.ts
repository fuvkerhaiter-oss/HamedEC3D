/**
 * Server-only direct PostgreSQL access (admin + storefront reads when DATABASE_URL is set).
 * Production: the Supabase Postgres connection string (transaction pooler, port 6543).
 * Local: the embedded dev database (`npm run db:local`). Never imported by client components.
 */
import postgres from "postgres";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Sql = postgres.Sql<{}>;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Tx = postgres.TransactionSql<{}>;
/** Either the pool or a transaction — services accept both so they compose inside transactions. */
export type Db = Sql | Tx;

/** bigint → JS number, refusing values outside the safe-integer range (money is integer minor units). */
const safeBigint = {
  to: 20,
  from: [20],
  serialize: (x: number | bigint) => x.toString(),
  parse: (x: string) => {
    const n = Number(x);
    if (!Number.isSafeInteger(n)) throw new Error(`bigint ${x} exceeds safe integer range`);
    return n;
  },
};

/**
 * Supabase's direct host (db.<ref>.supabase.co) resolves to IPv6 only. Vercel and many hosts have no IPv6,
 * so connecting fails with ENETUNREACH (and the build fails while prerendering /sitemap.xml, /, /catalog).
 * Returns a fix-it hint when the URL points there, otherwise null.
 */
export function directSupabaseHostHint(url: string): string | null {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!/^db\.[a-z0-9]+\.supabase\.co$/i.test(host)) return null;
  return (
    `DATABASE_URL uses Supabase's direct host (${host}), which is IPv6-only and unreachable from Vercel (ENETUNREACH). ` +
    "Use the Transaction pooler string instead: Supabase → Connect → Transaction pooler (…pooler.supabase.com:6543)."
  );
}

export function createSql(url: string, max = 5): Sql {
  const hint = directSupabaseHostHint(url);
  if (hint && (process.env.VERCEL || process.env.NODE_ENV === "production")) console.error(`[db] ${hint}`);
  return postgres(url, {
    max,
    prepare: false, // required by the Supabase transaction pooler
    idle_timeout: 20,
    connect_timeout: 5,
    onnotice: () => {},
    types: { bigint: safeBigint },
  }) as unknown as Sql;
}

/** The database did not answer in time (dead connection, overloaded pooler, lock wait). */
export class DbTimeoutError extends Error {
  override name = "DbTimeoutError";
  readonly code = "DB_TIMEOUT";
  constructor(ms: number) {
    super(`The database did not answer within ${Math.round(ms / 1000)} s.`);
  }
}

export interface GuardOptions {
  /** Longest one query may wait for its answer. */
  queryTimeoutMs?: number;
  /** Longest a whole `sql.begin(...)` transaction may take. */
  txTimeoutMs?: number;
  /** Replace the connections when nothing used them for this long (wall clock); 0 = never. */
  idleRecycleMs?: number;
  max?: number;
}

/**
 * The app's pool, guarded so a request can never hang until the platform kills it (Vercel 504):
 *
 * - postgres.js has no query timeout: once a connection is open, a query on a socket that went silently dead
 *   waits forever. On Vercel (Fluid compute) an instance is frozen between requests, its pool timers don't
 *   run, and the pooler/NAT drops the idle sockets meanwhile — the next request writes into a dead socket.
 *   So every query and transaction gets a deadline; on a timeout the whole pool is replaced (the next request
 *   opens fresh connections) and the caller gets a DbTimeoutError.
 * - Before a request uses connections that sat idle longer than `idleRecycleMs` (measured with the wall clock,
 *   which keeps running while the instance is frozen), they are replaced with fresh ones.
 *
 * The returned function is a stable facade: each call goes to the current pool, so code holding a reference
 * (e.g. across a slow Stripe call) never uses a retired pool. Queries inside a transaction (`tx`) are covered
 * by the transaction's deadline.
 */
export function createGuardedSql(url: string, opts: GuardOptions = {}): Sql {
  const queryTimeoutMs = opts.queryTimeoutMs ?? 10_000;
  const txTimeoutMs = opts.txTimeoutMs ?? 30_000;
  const idleRecycleMs = opts.idleRecycleMs ?? 15_000;
  type Pool = { sql: Sql; lastUsed: number; active: number; retired: boolean };
  let pool: Pool | null = null;

  const retire = (p: Pool, why: string) => {
    if (p.retired) return;
    p.retired = true;
    if (pool === p) pool = null;
    if (why !== "idle") console.warn(`[db] ${why} — replacing the connection pool`);
    void p.sql.end({ timeout: why === "idle" ? 5 : 1 }).catch(() => {});
  };
  const current = (): Pool => {
    if (pool && idleRecycleMs > 0 && pool.active === 0 && Date.now() - pool.lastUsed > idleRecycleMs) retire(pool, "idle");
    pool ??= { sql: createSql(url, opts.max), lastUsed: Date.now(), active: 0, retired: false };
    return pool;
  };
  const deadline = <T>(p: Pool, work: PromiseLike<T>, ms: number): Promise<T> => {
    p.active++;
    p.lastUsed = Date.now();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const done = () => {
        settled = true;
        clearTimeout(timer);
        p.active--;
        p.lastUsed = Date.now();
      };
      const timer = setTimeout(() => {
        if (settled) return;
        done();
        retire(p, `no answer from the database after ${ms} ms`);
        reject(new DbTimeoutError(ms));
      }, ms);
      work.then(
        (v) => { if (!settled) { done(); resolve(v); } },
        (e: unknown) => { if (!settled) { done(); reject(e); } },
      );
    });
  };
  /** A postgres.js query runs when first awaited (`then`): start its deadline there. */
  const guardQuery = (p: Pool, q: unknown): unknown => {
    if (!(q instanceof Promise)) return q; // helpers like sql(obj) / sql.json(x) are not queries
    const run = q.then;
    let guarded: Promise<unknown> | undefined;
    Object.defineProperty(q, "then", {
      configurable: true,
      value: (onOk?: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
        guarded ??= deadline(p, run.call(q) as Promise<unknown>, queryTimeoutMs);
        return guarded.then(onOk, onErr);
      },
    });
    return q;
  };

  const facade = function () {} as unknown as Sql;
  return new Proxy(facade, {
    apply: (_t, _this, args: unknown[]) => {
      const p = current();
      return guardQuery(p, (p.sql as unknown as (...a: unknown[]) => unknown)(...args));
    },
    get: (_t, prop) => {
      const p = current();
      const v = Reflect.get(p.sql, prop) as unknown;
      if (prop === "begin" && typeof v === "function") return (...a: unknown[]) => deadline(p, (v as (...x: unknown[]) => Promise<unknown>)(...a), txTimeoutMs);
      if (prop === "unsafe" && typeof v === "function") return (...a: unknown[]) => guardQuery(p, (v as (...x: unknown[]) => unknown)(...a));
      if (prop === "end" && typeof v === "function") return (...a: unknown[]) => { p.retired = true; if (pool === p) pool = null; return (v as (...x: unknown[]) => unknown)(...a); };
      return v;
    },
    has: (_t, prop) => Reflect.has(current().sql, prop),
  });
}

const globalForDb = globalThis as unknown as { __megamarketDb?: Sql };

/**
 * Connection string to use.
 * - On Vercel: the Vercel ↔ Supabase integration's POSTGRES_URL (IPv4 transaction pooler, port 6543, kept in
 *   sync by the integration) wins; DATABASE_URL is only a fallback.
 * - Elsewhere: DATABASE_URL wins (local dev DB), unless it points at Supabase's IPv6-only direct host and
 *   POSTGRES_URL is available.
 * Only sslmode is kept from POSTGRES_URL: the integration adds extra params (e.g. `supa=…`) that postgres.js
 * would send to the server as startup parameters.
 */
export function databaseUrl(env: Partial<NodeJS.ProcessEnv> = process.env): string | undefined {
  const direct = env.DATABASE_URL || undefined;
  const pooled = env.POSTGRES_URL ? cleanPoolerUrl(env.POSTGRES_URL) : undefined;
  if (env.VERCEL && pooled) return pooled;
  if (direct && !directSupabaseHostHint(direct)) return direct;
  return pooled ?? direct;
}

function cleanPoolerUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    const ssl = u.searchParams.get("sslmode");
    u.search = "";
    if (ssl) u.searchParams.set("sslmode", ssl);
    return u.toString();
  } catch {
    return undefined;
  }
}

export function isDbConfigured(): boolean {
  return Boolean(databaseUrl());
}

/** Shared guarded pool (survives dev hot reloads). Throws when DATABASE_URL is missing. */
export function getSql(): Sql {
  const url = databaseUrl();
  if (!url) throw new DbNotConfiguredError();
  globalForDb.__megamarketDb ??= createGuardedSql(url);
  return globalForDb.__megamarketDb;
}

export class DbNotConfiguredError extends Error {
  override name = "DbNotConfiguredError";
  constructor() {
    super("DATABASE_URL is not set — the admin dashboard needs a PostgreSQL connection (see INTEGRATION_GUIDE.md).");
  }
}

/** Run fn inside a transaction (or reuse the given transaction). */
export async function inTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if ("savepoint" in db) return fn(db as Tx);
  return (db as Sql).begin((tx) => fn(tx as unknown as Tx)) as Promise<T>;
}

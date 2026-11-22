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
    connect_timeout: 10,
    onnotice: () => {},
    types: { bigint: safeBigint },
  }) as unknown as Sql;
}

const globalForDb = globalThis as unknown as { __megamarketSql?: Sql };

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

/** Shared pool (survives dev hot reloads). Throws when DATABASE_URL is missing. */
export function getSql(): Sql {
  const url = databaseUrl();
  if (!url) throw new DbNotConfiguredError();
  globalForDb.__megamarketSql ??= createSql(url);
  return globalForDb.__megamarketSql;
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

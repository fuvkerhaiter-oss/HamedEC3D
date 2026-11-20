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

export function createSql(url: string, max = 5): Sql {
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

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Shared pool (survives dev hot reloads). Throws when DATABASE_URL is missing. */
export function getSql(): Sql {
  const url = process.env.DATABASE_URL;
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

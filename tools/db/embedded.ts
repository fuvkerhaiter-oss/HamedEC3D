/**
 * LOCAL DEVELOPMENT / TEST DATABASE. Starts a real PostgreSQL server (npm `embedded-postgres`), applies the
 * Supabase stubs + every migration in supabase/migrations (tracked), and seeds sample data on first creation.
 * Production uses the hosted Supabase Postgres via DATABASE_URL instead — never this.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

export interface LocalDbOptions {
  name: string; // data directory name (dev, e2e, test-xyz)
  port: number;
  fresh?: boolean; // wipe the data directory first
  seed?: boolean; // apply supabase/seed.sql on first creation (default true)
  dir?: string;
}

export interface LocalDb {
  url: string;
  stop(): Promise<void>;
}

export function localDbDir(name: string): string {
  // Outside the (OneDrive-synced) project folder: a live Postgres data dir must not be synced.
  return path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "megamarket-db", name);
}

export async function applyMigrations(url: string, opts: { seed: boolean }): Promise<string[]> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const applied: string[] = [];
  try {
    await sql.unsafe(readFileSync(path.join(ROOT, "supabase", "local", "supabase_stubs.sql"), "utf8")).simple();
    await sql`create schema if not exists local_meta`;
    await sql`create table if not exists local_meta.migrations (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await sql<{ name: string }[]>`select name from local_meta.migrations`).map((r) => r.name));
    const fresh = done.size === 0;
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(path.join(MIGRATIONS, file), "utf8")).simple();
        await tx`insert into local_meta.migrations (name) values (${file})`;
      });
      applied.push(file);
    }
    if (fresh && opts.seed) await sql.unsafe(readFileSync(path.join(ROOT, "supabase", "seed.sql"), "utf8")).simple();
  } finally {
    await sql.end();
  }
  return applied;
}

export async function startLocalDb(opts: LocalDbOptions): Promise<LocalDb> {
  const dir = opts.dir ?? localDbDir(opts.name);
  if (opts.fresh && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: opts.port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: (e) => console.error("[local-db]", String(e)),
  });
  if (!existsSync(path.join(dir, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  const url = `postgres://postgres:postgres@127.0.0.1:${opts.port}/postgres`;
  await applyMigrations(url, { seed: opts.seed ?? true });
  return { url, stop: () => pg.stop() };
}

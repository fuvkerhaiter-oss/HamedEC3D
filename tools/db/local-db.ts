/**
 * npm run db:local [-- --name dev --port 54329 --fresh]
 * Runs a local PostgreSQL (development only) until Ctrl+C. Put the printed DATABASE_URL in .env.local.
 */
import { startLocalDb } from "./embedded";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const name = arg("name") ?? "dev";
const port = Number(arg("port") ?? 54329);
const fresh = process.argv.includes("--fresh");

const db = await startLocalDb({ name, port, fresh });
console.log(`[local-db] "${name}" ready — DATABASE_URL=${db.url}`);
const keepAlive = setInterval(() => {}, 1 << 30);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(keepAlive);
  await db.stop().catch(() => {});
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

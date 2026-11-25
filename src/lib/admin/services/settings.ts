/** store_settings key/value access + typed settings used across the admin. */
import type { Db } from "../../db/client";
import { logActivity, type Actor } from "../audit";

export async function getSetting(db: Db, key: string): Promise<unknown> {
  const [row] = await db<{ value: unknown }[]>`select value from public.store_settings where key = ${key}`;
  return row?.value ?? null;
}

export async function getSettings(db: Db): Promise<Record<string, unknown>> {
  const rows = await db<{ key: string; value: unknown }[]>`select key, value from public.store_settings`;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(db: Db, actor: Actor, key: string, value: unknown): Promise<void> {
  const before = await getSetting(db, key);
  await db`
    insert into public.store_settings (key, value, updated_by, updated_at) values (${key}, ${db.json(JSON.parse(JSON.stringify(value)))}, ${actor.id}, now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
  await logActivity(db, actor, { action: "settings.update", entity: "setting", entityId: key, summary: `Updated ${key}`, before, after: value });
}

export async function lowStockDefault(db: Db): Promise<number> {
  const v = await getSetting(db, "store.default_low_stock_threshold");
  // The query compares this against an int column; a float or out-of-range value would fail the whole
  // dashboard. Keep the same bounds as the settings form (0–100000) and fall back to 5 otherwise.
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100_000 ? v : 5;
}

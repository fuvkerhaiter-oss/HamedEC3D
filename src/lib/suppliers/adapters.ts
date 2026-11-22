/** Server-side supplier adapter factory (reads credentials from env; never import from client code). */
import { aliexpressConfigFromEnv, createAliExpressAdapter } from "./aliexpress/adapter";
import { createMockSupplier } from "./mock-supplier";
import type { SupplierAdapter } from "./types";

export type AdapterConnection = { status: "connected" | "not_connected" | "not_applicable"; detail: string };

/** Whether the credentials an adapter needs are present (does not call the supplier). */
export function adapterConnection(key: string, env: NodeJS.ProcessEnv = process.env): AdapterConnection {
  if (key === "manual" || key === "alibaba") return { status: "not_applicable", detail: "Manual fulfillment — no API connection." };
  if (key === "mock") return env.NODE_ENV !== "production" ? { status: "connected", detail: "Mock (development only)." } : { status: "not_connected", detail: "Disabled in production." };
  if (key === "aliexpress") {
    return aliexpressConfigFromEnv(env)
      ? { status: "connected", detail: "Credentials present. Use “Test connection” to verify them with AliExpress." }
      : { status: "not_connected", detail: "Set ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET and ALIEXPRESS_ACCESS_TOKEN on the server." };
  }
  return { status: "not_connected", detail: `No adapter "${key}" is implemented.` };
}

/** Returns an adapter for API suppliers; null means manual fulfillment. Throws when the adapter is unknown or not configured. */
export function getSupplierAdapter(key: string, supplierId: string, env: NodeJS.ProcessEnv = process.env): SupplierAdapter | null {
  if (key === "manual" || key === "alibaba") return null;
  if (key === "mock" && env.NODE_ENV !== "production") return createMockSupplier({ id: supplierId });
  if (key === "aliexpress") {
    const cfg = aliexpressConfigFromEnv(env);
    if (!cfg) throw new Error("AliExpress is not connected: ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET / ALIEXPRESS_ACCESS_TOKEN missing");
    return createAliExpressAdapter({ ...cfg, id: supplierId });
  }
  throw new Error(`No supplier adapter "${key}" is implemented`);
}

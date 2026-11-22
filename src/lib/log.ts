/**
 * Server error logging without customer data. Database errors can carry the query PARAMETERS (emails,
 * addresses) — never log the raw error object; log name, code and a truncated message only.
 */
export function safeError(e: unknown): { name: string; code?: string; message: string } {
  const err = e as { name?: string; code?: string; message?: string };
  const message = String(err?.message ?? e).replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]").slice(0, 300);
  return { name: err?.name ?? "Error", ...(err?.code ? { code: String(err.code) } : {}), message };
}

export function logError(label: string, e: unknown): void {
  console.error(`[${label}]`, JSON.stringify(safeError(e)));
}

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "CONNECT_TIMEOUT", "DB_TIMEOUT", "CONNECTION_DESTROYED", "CONNECTION_CLOSED"]);
const warned = new Set<string>();

/**
 * The database can't be used at all — not running, wrong host, or the server/pooler refused the connection
 * (wrong user/password/region: Supabase's pooler answers FATAL XX000 "Tenant or user not found") — as opposed
 * to a single query failing (severity ERROR).
 */
export function isDbUnreachable(e: unknown): boolean {
  const err = e as { code?: string; severity?: string; severity_local?: string; errors?: { code?: string }[] };
  if (CONNECTION_CODES.has(String(err?.code)) || (err?.errors ?? []).some((x) => CONNECTION_CODES.has(String(x?.code)))) return true;
  const code = String(err?.code ?? "");
  return err?.severity === "FATAL" || err?.severity_local === "FATAL" || code.startsWith("08") || code.startsWith("28") || code === "3D000" ||
    // 57014 statement timeout (Supabase cancels slow queries: database overloaded or a query stuck behind a lock),
    // 57P01–57P03 server shutting down / not accepting connections yet.
    code === "57014" || code.startsWith("57P");
}

/**
 * A storefront read that has a safe fallback failed. In development an unreachable local database is a
 * normal state (fallback data is shown): one warning per label, not a red error overlay on every request.
 * Everything else — and every failure in production — is logged as an error.
 */
export function logFallback(label: string, e: unknown): void {
  if (process.env.NODE_ENV !== "production" && isDbUnreachable(e)) {
    if (warned.has(label)) return;
    warned.add(label);
    console.warn(`[${label}] local database not reachable — using fallback data. Start it with: npm run db:local`);
    return;
  }
  logError(label, e);
}

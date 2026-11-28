/** PII-free error summary (shared by log.ts and monitoring.ts; no imports so both can use it). */
export function safeError(e: unknown): { name: string; code?: string; message: string } {
  const err = e as { name?: string; code?: string; message?: string };
  const message = String(err?.message ?? e).replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]").slice(0, 300);
  return { name: err?.name ?? "Error", ...(err?.code ? { code: String(err.code) } : {}), message };
}

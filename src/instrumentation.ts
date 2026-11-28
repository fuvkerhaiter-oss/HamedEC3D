/**
 * Next.js server instrumentation: every unhandled server error (pages, route handlers, server actions) is logged
 * PII-free and, in production, sent to OPS_ALERT_WEBHOOK_URL (lib/monitoring.ts). Handled errors keep their own
 * logError() calls (checkout, webhooks, cron, email outbox).
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  const { logError } = await import("./lib/log");
  const route = (context.routePath || request.path.split("?")[0] || "").slice(0, 120);
  logError(`unhandled ${context.routeType} error ${request.method} ${route}`, err);
}

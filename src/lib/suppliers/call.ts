import { SupplierError } from "./types";

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 8000, timeoutMs: 15000 };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run a supplier operation with a per-attempt timeout and exponential backoff.
 * Only retryable SupplierErrors are retried. Non-SupplierErrors are wrapped as "unknown".
 */
export async function callSupplier<T>(
  op: (signal: AbortSignal) => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<T> {
  let lastError: SupplierError | undefined;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new SupplierError(`Supplier call timed out after ${policy.timeoutMs}ms`, "timeout"));
        }, policy.timeoutMs);
      });
      return await Promise.race([op(controller.signal), timeout]);
    } catch (err) {
      lastError = err instanceof SupplierError ? err : new SupplierError(String((err as Error)?.message ?? err), "unknown");
      if (!lastError.retryable || attempt === policy.maxAttempts) throw lastError;
      await sleep(Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1)));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError ?? new SupplierError("Supplier call failed", "unknown");
}

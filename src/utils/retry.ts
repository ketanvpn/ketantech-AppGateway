import { logger } from "./logger";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  /** Hanya retry jika fungsi ini return true. Default: selalu retry. */
  shouldRetry?: (err: unknown) => boolean;
  /** Label untuk logging */
  label?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Jalankan fungsi dengan retry exponential backoff.
 * Backoff: baseDelay * 2^attempt + jitter (0-100ms).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retriable = opts.shouldRetry ? opts.shouldRetry(err) : true;
      const isLast = attempt === opts.maxAttempts - 1;

      logger.warn(
        {
          label: opts.label,
          attempt: attempt + 1,
          maxAttempts: opts.maxAttempts,
          retriable,
          err: err instanceof Error ? err.message : String(err),
        },
        "retry attempt failed",
      );

      if (!retriable || isLast) break;

      const delay =
        opts.baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
      await sleep(delay);
    }
  }
  throw lastErr;
}

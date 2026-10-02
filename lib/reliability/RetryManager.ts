/**
 * Exponential backoff retry — 1s, 2s, 4s, 8s (cap 10s). Network errors only.
 */
import { isNetworkError } from '@/lib/safeNetwork';
import { getNetworkState } from '@/lib/reliability/NetworkManager';
import { logRetry } from '@/lib/reliability/reliabilityLog';
import { requestMonitorRun } from '@/lib/reliability/RequestMonitor';
import { captureReliabilityError } from '@/lib/reliability/SentryManager';

/** Backoff schedule in ms — capped at 10s. */
export const RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000, 10000] as const;

export type RetryFnOptions = {
  label?: string;
  /** Total attempts including the first try. Default 5. */
  maxRetries?: number;
  timeoutMs?: number;
  /** Only retry when this returns true. Default: network-shaped errors. */
  shouldRetry?: (err: unknown) => boolean;
  /** Fail immediately when offline. */
  requireOnline?: boolean;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffForAttempt(attemptIndex: number): number {
  const idx = Math.min(attemptIndex, RETRY_BACKOFF_MS.length - 1);
  return RETRY_BACKOFF_MS[idx]!;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label?: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => {
      reject(
        Object.assign(new Error(`retry_timeout${label ? `:${label}` : ''}`), {
          code: 'deadline-exceeded',
        })
      );
    }, timeoutMs);
    promise
      .then((v) => {
        clearTimeout(handle);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(handle);
        reject(e);
      });
  });
}

/**
 * Retry an async function with exponential backoff.
 * @example await retry(() => sendMessage(...), { label: 'send_message', maxRetries: 4 })
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryFnOptions = {}): Promise<T> {
  const {
    label = 'operation',
    maxRetries = 5,
    timeoutMs = 30_000,
    shouldRetry = isNetworkError,
    requireOnline = false,
  } = options;

  if (requireOnline && !getNetworkState().isOnline) {
    logRetry('BLOCKED_OFFLINE', { label });
    throw Object.assign(new Error('network_offline'), { code: 'network/offline' });
  }

  const tunedTimeout =
    getNetworkState().isPoorConnection ? Math.max(timeoutMs, 45_000) : timeoutMs;
  const tunedMax = getNetworkState().isPoorConnection ? Math.max(maxRetries, 6) : maxRetries;

  return requestMonitorRun(label, async () => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= tunedMax; attempt++) {
      try {
        const result = await withTimeout(fn(), tunedTimeout, label);
        if (attempt > 1) {
          logRetry('SUCCESS_AFTER_RETRY', { label, attempt });
        }
        return result;
      } catch (err) {
        lastError = err;
        const retriable = shouldRetry(err);
        logRetry('ATTEMPT_FAIL', {
          label,
          attempt,
          maxRetries: tunedMax,
          retriable,
          reason: err instanceof Error ? err.message : String(err),
        });

        if (!retriable || attempt >= tunedMax) {
          logRetry('EXHAUSTED', { label, attempt, reason: err instanceof Error ? err.message : String(err) });
          captureReliabilityError('retry', err, { label, attempt });
          throw err;
        }

        const waitMs = backoffForAttempt(attempt - 1);
        logRetry('BACKOFF', { label, attempt, waitMs });
        await delay(waitMs);
      }
    }
    throw lastError ?? new Error(`retry_failed:${label}`);
  });
}

/** Backward-compatible alias used across the codebase. */
export async function retryOperation<T>(
  op: () => Promise<T>,
  options: RetryFnOptions & { maxAttempts?: number; waitForReconnect?: boolean } = {}
): Promise<T> {
  return retry(op, {
    label: options.label,
    maxRetries: options.maxAttempts ?? options.maxRetries ?? 5,
    timeoutMs: options.timeoutMs,
    shouldRetry: options.shouldRetry,
    requireOnline: options.requireOnline,
  });
}

export async function retryAuthOperation<T>(op: () => Promise<T>, label: string): Promise<T> {
  return retry(op, {
    label,
    timeoutMs: 45_000,
    maxRetries: 6,
    requireOnline: true,
  });
}

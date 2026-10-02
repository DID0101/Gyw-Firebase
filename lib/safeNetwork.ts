/**
 * Thin wrapper for protecting Firebase / fetch / WebRTC operations from
 * weak-internet failure modes (timeouts, transient `unavailable`/`network-request-failed`).
 *
 * Goals:
 *   - never hang forever (`timeoutMs`)
 *   - retry transient errors with exponential backoff + jitter
 *   - skip silly retries on real failures (`permission-denied`, `unauthenticated`, `invalid-argument`)
 *   - emit a single dev log per failed call so we can diagnose retry storms
 *
 * Designed to be used at the SERVICE boundary (callers in `lib/services/*`),
 * not inside React components.
 */

import { getNetworkSnapshot, waitForOnline } from '@/lib/networkState';
import { logRetry } from '@/lib/reliability/reliabilityLog';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_DELAY_MS = 400;
const DEFAULT_MAX_DELAY_MS = 4000;

export interface SafeNetworkOptions {
  /** Operation label for logs (e.g. "send_message"). */
  label?: string;
  /** Per-attempt timeout. Default 15s. */
  timeoutMs?: number;
  /** Total attempts (1 = no retry). Default 3. */
  maxAttempts?: number;
  /** Initial backoff (doubles each retry). Default 400ms. */
  initialDelayMs?: number;
  /** Caps the backoff. Default 4s. */
  maxDelayMs?: number;
  /** If true, await the network coming back online before each retry (max 8s). */
  waitForReconnect?: boolean;
  /** Custom predicate to decide whether to retry. Defaults to network-shaped errors. */
  shouldRetry?: (err: unknown) => boolean;
}

const NON_RETRIABLE_CODES = new Set([
  'permission-denied',
  'unauthenticated',
  'invalid-argument',
  'not-found',
  'failed-precondition',
  'already-exists',
  'aborted',
  'firestore/permission-denied',
  'firestore/unauthenticated',
  'firestore/invalid-argument',
  'firestore/not-found',
  'auth/invalid-credential',
]);

const RETRIABLE_HINTS = [
  'network',
  'timeout',
  'timed out',
  'unavailable',
  'deadline-exceeded',
  'temporary',
  'connection',
  'reset',
  'cancelled',
];

function errorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const anyErr = err as { code?: unknown; name?: unknown };
    if (typeof anyErr.code === 'string') return anyErr.code;
    if (typeof anyErr.name === 'string') return anyErr.name;
  }
  return '';
}

function errorMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message ?? '';
  return String(err);
}

export function isNetworkError(err: unknown): boolean {
  const code = errorCode(err).toLowerCase();
  if (!code && !err) return false;
  if (NON_RETRIABLE_CODES.has(code)) return false;
  if (code === 'unavailable' || code === 'deadline-exceeded') return true;
  if (code.includes('network') || code.includes('timeout')) return true;
  const msg = errorMessage(err).toLowerCase();
  return RETRIABLE_HINTS.some((hint) => msg.includes(hint));
}

function defaultShouldRetry(err: unknown): boolean {
  if (NON_RETRIABLE_CODES.has(errorCode(err).toLowerCase())) return false;
  return isNetworkError(err);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label?: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => {
      const err = Object.assign(new Error(`network_timeout${label ? `:${label}` : ''}`), {
        code: 'deadline-exceeded',
      });
      reject(err);
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(handle);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(handle);
        reject(err);
      });
  });
}

/**
 * Run an async network operation with timeout, exponential backoff retries, and
 * optional reconnect-await. Throws the *last* error so callers can still react
 * to a definitive failure.
 */
export async function withNetworkSafety<T>(
  op: () => Promise<T>,
  options: SafeNetworkOptions = {}
): Promise<T> {
  const {
    label,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    waitForReconnect = true,
    shouldRetry = defaultShouldRetry,
  } = options;

  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await withTimeout(op(), timeoutMs, label);
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !shouldRetry(err)) {
        logRetry('EXHAUSTED', {
          label,
          attempt,
          code: errorCode(err),
          message: errorMessage(err),
        });
        if (__DEV__) {
          console.warn('SAFE_NETWORK_FAIL', { label, attempt, code: errorCode(err), message: errorMessage(err) });
        }
        throw err;
      }

      logRetry('ATTEMPT', {
        label,
        attempt,
        code: errorCode(err),
        message: errorMessage(err),
      });
      if (__DEV__) {
        console.log('SAFE_NETWORK_RETRY', { label, attempt, code: errorCode(err), message: errorMessage(err) });
      }

      const backoff = Math.min(maxDelayMs, initialDelayMs * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * Math.min(250, backoff));
      await delay(backoff + jitter);

      if (waitForReconnect && !getNetworkSnapshot().isOnline) {
        try {
          await waitForOnline(8000);
        } catch {
          /* fall through — let the next attempt time out naturally */
        }
      }
    }
  }

  throw lastError ?? new Error(`network_failed${label ? `:${label}` : ''}`);
}

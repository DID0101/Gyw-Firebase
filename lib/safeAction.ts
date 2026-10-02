import { logActionDuplicateBlocked } from '@/lib/perf/productionTelemetry';
import { useCallback, useRef, useState } from 'react';

type MaybePromise<T> = T | Promise<T>;

type InFlightEntry<T> = {
  promise: Promise<T>;
  startedAt: number;
};

const inFlight = new Map<string, InFlightEntry<unknown>>();
const recentCompletion = new Map<string, { value: unknown; completedAt: number }>();
const navLocks = new Map<string, number>();

const DEFAULT_DEBOUNCE_MS = 700;
const DEFAULT_NAV_DEBOUNCE_MS = 900;

function logBlocked(message: string, data: Record<string, unknown>) {
  logActionDuplicateBlocked(String(data.key ?? ''), String(data.reason ?? ''));
  if (__DEV__) console.log(message, data);
}

function keyFromTarget(target: unknown): string {
  if (typeof target === 'string') return target;
  try {
    return JSON.stringify(target);
  } catch {
    return String(target);
  }
}

export async function runOnceByKey<T>(
  key: string,
  action: () => Promise<T>,
  options?: {
    debounceMs?: number;
    logLabel?: string;
    blockedLog?: string;
  }
): Promise<T> {
  const now = Date.now();
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const running = inFlight.get(key) as InFlightEntry<T> | undefined;
  if (running) {
    logBlocked(options?.blockedLog ?? 'SAFE_ACTION_BLOCKED', {
      key,
      label: options?.logLabel,
      reason: 'in_flight',
    });
    return running.promise;
  }

  const recent = recentCompletion.get(key);
  if (recent && now - recent.completedAt < debounceMs) {
    logBlocked(options?.blockedLog ?? 'SAFE_ACTION_BLOCKED', {
      key,
      label: options?.logLabel,
      reason: 'recent_completion',
    });
    return recent.value as T;
  }

  const promise = action();
  inFlight.set(key, { promise, startedAt: now });
  try {
    const value = await promise;
    recentCompletion.set(key, { value, completedAt: Date.now() });
    setTimeout(() => {
      const current = recentCompletion.get(key);
      if (current?.value === value) recentCompletion.delete(key);
    }, debounceMs + 50);
    return value;
  } catch (error) {
    recentCompletion.delete(key);
    throw error;
  } finally {
    inFlight.delete(key);
  }
}

export function useSafeAction<TArgs extends unknown[], TResult>(
  key: string,
  action: (...args: TArgs) => MaybePromise<TResult>,
  options?: {
    debounceMs?: number;
    logLabel?: string;
  }
) {
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);
  const lastRunAtRef = useRef(0);

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      const now = Date.now();
      const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
      if (runningRef.current || now - lastRunAtRef.current < debounceMs) {
        logBlocked('SAFE_ACTION_BLOCKED', {
          key,
          label: options?.logLabel,
          reason: runningRef.current ? 'in_flight' : 'debounce',
        });
        return undefined;
      }

      runningRef.current = true;
      lastRunAtRef.current = now;
      setIsRunning(true);
      try {
        return await action(...args);
      } finally {
        runningRef.current = false;
        setIsRunning(false);
      }
    },
    [action, key, options?.debounceMs, options?.logLabel]
  );

  return { run, isRunning };
}

export function navigateOnce(
  router: { push?: (target: any) => unknown; replace?: (target: any) => unknown; back?: () => unknown },
  method: 'push' | 'replace' | 'back',
  target?: unknown,
  options?: { debounceMs?: number; key?: string }
): boolean {
  const key = options?.key ?? `${method}:${keyFromTarget(target)}`;
  const now = Date.now();
  const lastAt = navLocks.get(key);
  const debounceMs = options?.debounceMs ?? DEFAULT_NAV_DEBOUNCE_MS;
  if (lastAt && now - lastAt < debounceMs) {
    logBlocked('NAV_DUPLICATE_BLOCKED', { route: key, method });
    return false;
  }
  navLocks.set(key, now);
  setTimeout(() => {
    if (navLocks.get(key) === now) navLocks.delete(key);
  }, debounceMs + 50);

  if (method === 'back') {
    if (router.canGoBack?.()) {
      router.back?.();
    }
  } else {
    router[method]?.(target as any);
  }
  return true;
}

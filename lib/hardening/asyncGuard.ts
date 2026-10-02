import { useEffect, useRef } from 'react';

import { logSafeAsyncCancelled } from '@/lib/perf/productionTelemetry';

/** Ref true while component is mounted — guard async setState after await. */
export function useIsMountedRef(): { current: boolean } {
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);
  return ref;
}

/** No-op after unmount; logs SAFE_ASYNC_CANCELLED in dev. */
export function guardAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  label: string,
  isMounted: { current: boolean }
): T {
  return (async (...args: Parameters<T>) => {
    const result = await fn(...args);
    if (!isMounted.current) {
      logSafeAsyncCancelled(label);
      return undefined;
    }
    return result;
  }) as T;
}

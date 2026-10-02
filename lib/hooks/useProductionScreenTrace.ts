import { useEffect } from 'react';

import { logScreenFailed, logScreenMounted } from '@/lib/debug/productionDiagnostics';

/**
 * Logs SCREEN_MOUNTED / SCREEN_FAILED for Play Store vs local debug comparison.
 */
export function useProductionScreenTrace(screenId: string, extra?: Record<string, unknown>) {
  useEffect(() => {
    try {
      logScreenMounted(screenId, extra);
    } catch (e) {
      logScreenFailed(screenId, e, { phase: 'mount' });
    }
    return () => {};
  }, [screenId]);
}

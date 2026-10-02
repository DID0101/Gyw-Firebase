/**
 * Tracks request duration, timeouts, and failure reasons.
 */
import { logRequest } from '@/lib/reliability/reliabilityLog';

type ActiveRequest = { label: string; startedAt: number };

const active = new Map<string, ActiveRequest>();
let requestSeq = 0;

export async function requestMonitorRun<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const id = `${label}:${++requestSeq}`;
  const startedAt = Date.now();
  active.set(id, { label, startedAt });
  logRequest('START', { id, label });

  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    logRequest('END', { id, label, durationMs, ok: true });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const reason = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
    logRequest('END', { id, label, durationMs, ok: false, reason, code });
    throw err;
  } finally {
    active.delete(id);
  }
}

export function getActiveRequestCount(): number {
  return active.size;
}

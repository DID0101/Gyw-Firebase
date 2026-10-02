/**
 * Production-safe performance telemetry (console.error → visible in release logcat).
 * Tags: PERF_SCREEN_OPEN | PERF_QUERY_START | PERF_QUERY_END | PERF_RENDER_COUNT | PERF_RERENDER_REASON
 */
import { prodDebug } from '@/lib/debug/prodDebug';

const queryStarts = new Map<string, number>();
const renderCounts = new Map<string, number>();

export function perfScreenOpen(screen: string, extra?: Record<string, unknown>): void {
  prodDebug('PERF_SCREEN_OPEN', { screen, ts: Date.now(), ...extra });
}

export function perfQueryStart(key: string, extra?: Record<string, unknown>): void {
  queryStarts.set(key, Date.now());
  prodDebug('PERF_QUERY_START', { key, ts: Date.now(), ...extra });
}

export function perfQueryEnd(key: string, extra?: Record<string, unknown>): void {
  const started = queryStarts.get(key);
  const elapsedMs = started != null ? Date.now() - started : null;
  queryStarts.delete(key);
  prodDebug('PERF_QUERY_END', { key, elapsedMs, ts: Date.now(), ...extra });
}

export function perfRenderCount(component: string, reason?: string): void {
  const count = (renderCounts.get(component) ?? 0) + 1;
  renderCounts.set(component, count);
  if (__DEV__ || count <= 3 || count % 10 === 0) {
    prodDebug('PERF_RENDER_COUNT', { component, count, reason: reason ?? null, ts: Date.now() });
  }
}

export function perfRerenderReason(component: string, reason: string, extra?: Record<string, unknown>): void {
  prodDebug('PERF_RERENDER_REASON', { component, reason, ts: Date.now(), ...extra });
}

export function resetPerfRenderCount(component: string): void {
  renderCounts.delete(component);
}

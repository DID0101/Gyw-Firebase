/**
 * Hooks global setInterval / setTimeout — logs active timers and flags aggressive intervals.
 */
import { DebugLogger } from '@/lib/debug/networkAudit/DebugLogger';
import { getAuditScreen } from '@/lib/debug/networkAudit/auditContext';

type TimerKind = 'interval' | 'timeout';

type TimerRecord = {
  id: number;
  kind: TimerKind;
  delayMs: number;
  createdAt: number;
  screen: string;
  callerHint: string;
  cleared: boolean;
};

const AGGRESSIVE_INTERVAL_MS = 5_000;
const activeTimers = new Map<number, TimerRecord>();
const nativeToAuditId = new Map<number, number>();
let nextTimerId = 0;
let originalSetInterval: typeof setInterval | null = null;
let originalSetTimeout: typeof setTimeout | null = null;
let originalClearInterval: typeof clearInterval | null = null;
let originalClearTimeout: typeof clearTimeout | null = null;
let installed = false;

function extractCallerHint(): string {
  const stack = new Error().stack ?? '';
  return stack.split('\n').slice(2, 5).map((l) => l.trim()).join(' | ') || 'unknown';
}

function registerTimer(kind: TimerKind, delayMs: number, nativeId: ReturnType<typeof setInterval>): number {
  const auditId = ++nextTimerId;
  const rec: TimerRecord = {
    id: auditId,
    kind,
    delayMs,
    createdAt: Date.now(),
    screen: getAuditScreen(),
    callerHint: extractCallerHint(),
    cleared: false,
  };
  activeTimers.set(auditId, rec);
  nativeToAuditId.set(nativeId as unknown as number, auditId);

  DebugLogger.logTimer(kind === 'interval' ? 'TIMER_INTERVAL_SET' : 'TIMER_TIMEOUT_SET', {
    auditId,
    nativeId: String(nativeId),
    delayMs,
    screen: rec.screen,
    callerHint: rec.callerHint,
    activeCount: [...activeTimers.values()].filter((t) => !t.cleared).length,
  });

  if (kind === 'interval' && delayMs > 0 && delayMs < AGGRESSIVE_INTERVAL_MS) {
    DebugLogger.warnTimer('AGGRESSIVE_INTERVAL', {
      auditId,
      delayMs,
      screen: rec.screen,
      callerHint: rec.callerHint,
      message: `setInterval every ${delayMs}ms — may cause idle data/battery drain`,
    });
  }

  return auditId;
}

function markCleared(nativeId: ReturnType<typeof setInterval>, kind: TimerKind): void {
  const auditId = nativeToAuditId.get(nativeId as unknown as number);
  if (auditId == null) return;
  const rec = activeTimers.get(auditId);
  if (!rec || rec.cleared) return;
  rec.cleared = true;
  nativeToAuditId.delete(nativeId as unknown as number);
  DebugLogger.logTimer(kind === 'interval' ? 'TIMER_INTERVAL_CLEAR' : 'TIMER_TIMEOUT_CLEAR', {
    auditId: rec.id,
    lifetimeMs: Date.now() - rec.createdAt,
  });
}

export function installTimerScanner(): void {
  if (!__DEV__ || installed) return;
  installed = true;

  originalSetInterval = globalThis.setInterval.bind(globalThis);
  originalSetTimeout = globalThis.setTimeout.bind(globalThis);
  originalClearInterval = globalThis.clearInterval.bind(globalThis);
  originalClearTimeout = globalThis.clearTimeout.bind(globalThis);

  globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const nativeId = originalSetInterval!(handler, timeout, ...(args as []));
    registerTimer('interval', timeout ?? 0, nativeId);
    return nativeId;
  }) as typeof setInterval;

  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const nativeId = originalSetTimeout!(handler, timeout, ...(args as []));
    registerTimer('timeout', timeout ?? 0, nativeId);
    return nativeId;
  }) as typeof setTimeout;

  globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
    markCleared(id, 'interval');
    originalClearInterval!(id);
  }) as typeof clearInterval;

  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    markCleared(id, 'timeout');
    originalClearTimeout!(id);
  }) as typeof clearTimeout;

  DebugLogger.logTimer('TIMER_SCANNER_INSTALLED', {});
}

export function getActiveTimersSnapshot(): TimerRecord[] {
  return [...activeTimers.values()].filter((t) => !t.cleared);
}

export function logActiveTimersReport(): void {
  if (!__DEV__) return;
  const active = getActiveTimersSnapshot();
  const intervals = active.filter((t) => t.kind === 'interval');
  DebugLogger.logReport('ACTIVE_TIMERS', {
    totalActive: active.length,
    intervals: intervals.map((t) => ({
      delayMs: t.delayMs,
      screen: t.screen,
      ageMs: Date.now() - t.createdAt,
      callerHint: t.callerHint,
    })),
  });
}

export function uninstallTimerScanner(): void {
  if (!installed) return;
  if (originalSetInterval) globalThis.setInterval = originalSetInterval;
  if (originalSetTimeout) globalThis.setTimeout = originalSetTimeout;
  if (originalClearInterval) globalThis.clearInterval = originalClearInterval;
  if (originalClearTimeout) globalThis.clearTimeout = originalClearTimeout;
  installed = false;
}

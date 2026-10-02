/**
 * Tracks Firestore onSnapshot listeners — attach, detach, snapshot volume, leak warnings.
 */
import { DebugLogger } from '@/lib/debug/networkAudit/DebugLogger';
import {
  currentHourBucket,
  getAuditScreen,
  getScreenUnmountAgeMs,
} from '@/lib/debug/networkAudit/auditContext';

const LEAK_THRESHOLD_MS = 60_000;
const LEAK_CHECK_INTERVAL_MS = 15_000;

export type ListenerRecord = {
  id: string;
  path: string;
  screen: string;
  attachedAt: number;
  snapshotCount: number;
  lastSnapshotAt: number | null;
  lastSnapshotBytes: number;
  totalSnapshotBytes: number;
  detachedAt: number | null;
  callerHint: string;
};

let nextId = 0;
const active = new Map<string, ListenerRecord>();
let leakCheckTimer: ReturnType<typeof setInterval> | null = null;

function extractCallerHint(stack?: string): string {
  if (!stack) return 'unknown';
  const lines = stack.split('\n').slice(2, 6);
  return lines.map((l) => l.trim()).join(' | ') || 'unknown';
}

function resolveRefPath(ref: unknown): string {
  const r = ref as { path?: string; _path?: { segments?: string[] }; firestore?: { app?: { name?: string } } };
  if (typeof r?.path === 'string') return r.path;
  if (Array.isArray(r?._path?.segments)) return r._path.segments.join('/');
  return 'unknown-ref';
}

function estimateSnapshotBytes(snap: unknown): number {
  try {
    const s = snap as { size?: number; docs?: { length?: number }; data?: () => unknown; exists?: () => boolean };
    if (typeof s?.size === 'number') {
      return Math.max(s.size * 512, 256);
    }
    if (typeof s?.docs?.length === 'number') {
      return Math.max(s.docs.length * 512, 256);
    }
    if (typeof s?.data === 'function' && s.exists?.()) {
      return JSON.stringify(s.data()).length;
    }
    return 256;
  } catch {
    return 256;
  }
}

function checkLeaks(): void {
  if (!__DEV__) return;
  const now = Date.now();
  for (const rec of active.values()) {
    const unmountAge = getScreenUnmountAgeMs(rec.screen);
    if (unmountAge == null || unmountAge < LEAK_THRESHOLD_MS) continue;
    DebugLogger.warnLeak('LISTENER_LEAK_SUSPECT', {
      id: rec.id,
      path: rec.path,
      screen: rec.screen,
      unmountedAgoMs: unmountAge,
      snapshotCount: rec.snapshotCount,
      totalSnapshotBytes: rec.totalSnapshotBytes,
      attachedAgoMs: now - rec.attachedAt,
      callerHint: rec.callerHint,
      message: `Listener still active ${Math.round(unmountAge / 1000)}s after screen "${rec.screen}" unmounted`,
    });
  }
}

export function startListenerLeakWatcher(): void {
  if (!__DEV__ || leakCheckTimer) return;
  leakCheckTimer = setInterval(checkLeaks, LEAK_CHECK_INTERVAL_MS);
}

export function stopListenerLeakWatcher(): void {
  if (leakCheckTimer) {
    clearInterval(leakCheckTimer);
    leakCheckTimer = null;
  }
}

export function trackListenerAttach(ref: unknown, meta?: { label?: string; stack?: string }): string {
  if (!__DEV__) return '';
  const id = `lsn-${++nextId}`;
  const path = meta?.label ?? resolveRefPath(ref);
  const screen = getAuditScreen();
  const rec: ListenerRecord = {
    id,
    path,
    screen,
    attachedAt: Date.now(),
    snapshotCount: 0,
    lastSnapshotAt: null,
    lastSnapshotBytes: 0,
    totalSnapshotBytes: 0,
    detachedAt: null,
    callerHint: extractCallerHint(meta?.stack ?? new Error().stack),
  };
  active.set(id, rec);
  DebugLogger.logListener('LISTENER_ATTACH', {
    id,
    path,
    screen,
    hour: currentHourBucket(),
    activeCount: active.size,
    callerHint: rec.callerHint,
  });
  return id;
}

export function trackListenerSnapshot(listenerId: string, snap: unknown): void {
  if (!__DEV__ || !listenerId) return;
  const rec = active.get(listenerId);
  if (!rec) return;
  const bytes = estimateSnapshotBytes(snap);
  rec.snapshotCount += 1;
  rec.lastSnapshotAt = Date.now();
  rec.lastSnapshotBytes = bytes;
  rec.totalSnapshotBytes += bytes;
  if (rec.snapshotCount === 1 || rec.snapshotCount % 25 === 0) {
    DebugLogger.logListener('LISTENER_SNAPSHOT', {
      id: listenerId,
      path: rec.path,
      screen: rec.screen,
      snapshotCount: rec.snapshotCount,
      estBytes: bytes,
      totalSnapshotBytes: rec.totalSnapshotBytes,
      hour: currentHourBucket(),
    });
  }
}

export function trackListenerDetach(listenerId: string): void {
  if (!__DEV__ || !listenerId) return;
  const rec = active.get(listenerId);
  if (!rec) return;
  rec.detachedAt = Date.now();
  active.delete(listenerId);
  DebugLogger.logListener('LISTENER_DETACH', {
    id: listenerId,
    path: rec.path,
    screen: rec.screen,
    lifetimeMs: rec.detachedAt - rec.attachedAt,
    snapshotCount: rec.snapshotCount,
    totalSnapshotBytes: rec.totalSnapshotBytes,
    activeCount: active.size,
  });
}

export function trackNamedListenerEvent(
  event: 'START' | 'STOP',
  name: string,
  meta?: Record<string, unknown>
): void {
  if (!__DEV__) return;
  DebugLogger.logListener(event === 'START' ? 'NAMED_LISTENER_START' : 'NAMED_LISTENER_STOP', {
    name,
    screen: getAuditScreen(),
    hour: currentHourBucket(),
    activeCount: active.size,
    ...meta,
  });
}

export function getActiveListenerSnapshot(): ListenerRecord[] {
  return [...active.values()];
}

export function getListenerAuditSummary(): {
  activeCount: number;
  totalSnapshotBytes: number;
  byPath: Record<string, { count: number; bytes: number }>;
} {
  const byPath: Record<string, { count: number; bytes: number }> = {};
  let totalSnapshotBytes = 0;
  for (const rec of active.values()) {
    totalSnapshotBytes += rec.totalSnapshotBytes;
    const entry = byPath[rec.path] ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += rec.totalSnapshotBytes;
    byPath[rec.path] = entry;
  }
  return { activeCount: active.size, totalSnapshotBytes, byPath };
}

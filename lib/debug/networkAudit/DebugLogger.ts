/**
 * Unified debug logger for the Network Investigation & Audit Toolkit.
 * Filter Metro console with: NET_AUDIT
 */
export type AuditCategory =
  | 'LISTENER'
  | 'NETWORK'
  | 'PRESENCE'
  | 'TIMER'
  | 'IMAGE'
  | 'FIRESTORE_CONN'
  | 'REPORT';

type LogLevel = 'log' | 'warn' | 'error';

function emit(level: LogLevel, category: AuditCategory, event: string, payload: Record<string, unknown> = {}): void {
  if (!__DEV__) return;
  const line = `[NET_AUDIT][${category}] ${event} ${JSON.stringify({ ...payload, ts: Date.now() })}`;
  if (level === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(line);
    return;
  }
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(line);
}

export const DebugLogger = {
  logListener(event: string, payload?: Record<string, unknown>): void {
    emit('log', 'LISTENER', event, payload);
  },
  warnLeak(event: string, payload?: Record<string, unknown>): void {
    emit('warn', 'LISTENER', event, payload);
  },
  logNetwork(event: string, payload?: Record<string, unknown>): void {
    emit('log', 'NETWORK', event, payload);
  },
  warnNetwork(event: string, payload?: Record<string, unknown>): void {
    emit('warn', 'NETWORK', event, payload);
  },
  logPresence(event: string, payload?: Record<string, unknown>): void {
    emit('log', 'PRESENCE', event, payload);
  },
  warnPresence(event: string, payload?: Record<string, unknown>): void {
    emit('warn', 'PRESENCE', event, payload);
  },
  logTimer(event: string, payload?: Record<string, unknown>): void {
    emit('log', 'TIMER', event, payload);
  },
  warnTimer(event: string, payload?: Record<string, unknown>): void {
    emit('warn', 'TIMER', event, payload);
  },
  logImage(event: string, payload?: Record<string, unknown>): void {
    emit('log', 'IMAGE', event, payload);
  },
  warnImage(event: string, payload?: Record<string, unknown>): void {
    emit('warn', 'IMAGE', event, payload);
  },
  logFirestoreConn(event: string, payload?: Record<string, unknown>): void {
    emit('log', 'FIRESTORE_CONN', event, payload);
  },
  warnFirestoreConn(event: string, payload?: Record<string, unknown>): void {
    emit('warn', 'FIRESTORE_CONN', event, payload);
  },
  logReport(event: string, payload?: Record<string, unknown>): void {
    emit('log', 'REPORT', event, payload);
  },
};

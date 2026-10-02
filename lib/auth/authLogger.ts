/**
 * Structured auth refactor logs — filter: AUTH_STATE_TRANSITION
 */
import { prodDebug } from '@/lib/debug/prodDebug';

import type { AuthPhase } from './AuthState';

function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const c = String(phone);
  if (c.length <= 6) return 'REDACTED';
  return `${c.slice(0, 3)}***${c.slice(-2)}`;
}

export function logAuthStateTransition(payload: {
  from: AuthPhase;
  to: AuthPhase;
  reason: string;
  timestamp: number;
  userId?: string | null;
  phone?: string | null;
  networkOnline?: boolean;
  durationMs?: number;
  errorCode?: string;
}): void {
  const line = {
    tag: 'AUTH_STATE_TRANSITION',
    from: payload.from,
    to: payload.to,
    reason: payload.reason,
    timestamp: payload.timestamp,
    userId: payload.userId ? payload.userId.slice(0, 8) : null,
    phone: maskPhone(payload.phone),
    networkOnline: payload.networkOnline,
    durationMs: payload.durationMs,
    errorCode: payload.errorCode,
  };
  prodDebug('AUTH_STATE_TRANSITION', line);
  if (__DEV__) {
    try {
      // eslint-disable-next-line no-console
      console.log('[AUTH_STATE_TRANSITION]', JSON.stringify(line));
    } catch {
      // eslint-disable-next-line no-console
      console.log('[AUTH_STATE_TRANSITION]', line.from, '→', line.to, line.reason);
    }
  }
}

export function logAuthManager(tag: string, payload?: Record<string, unknown>): void {
  prodDebug(`AUTH_${tag}`, { ts: Date.now(), ...payload });
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log(`[AUTH_${tag}]`, payload ?? '');
  }
}

/**
 * Structured production-safe reliability logs.
 * Filter: adb logcat *:E | findstr /i "NETWORK REQUEST RETRY QUEUE AUTH FIRESTORE UPLOAD SYNC"
 */
import { prodDebug, prodDebugError } from '@/lib/debug/prodDebug';

export type ReliabilityTag =
  | 'NETWORK'
  | 'REQUEST'
  | 'RETRY'
  | 'QUEUE'
  | 'AUTH'
  | 'FIRESTORE'
  | 'UPLOAD'
  | 'SYNC'
  | 'SENTRY'
  | 'FIREBASE';

export function logSentry(event: string, payload?: Record<string, unknown>): void {
  emit('SENTRY', event, payload);
}

export function logFirebase(event: string, payload?: Record<string, unknown>): void {
  emit('FIREBASE', event, payload);
}

function emit(tag: ReliabilityTag, event: string, payload?: Record<string, unknown>): void {
  prodDebug(`${tag}`, { event, ts: Date.now(), ...payload });
}

export function logNetwork(event: string, payload?: Record<string, unknown>): void {
  emit('NETWORK', event, payload);
}

export function logRequest(event: string, payload?: Record<string, unknown>): void {
  emit('REQUEST', event, payload);
}

export function logRetry(event: string, payload?: Record<string, unknown>): void {
  emit('RETRY', event, payload);
}

export function logQueue(event: string, payload?: Record<string, unknown>): void {
  emit('QUEUE', event, payload);
}

export function logAuthReliability(event: string, payload?: Record<string, unknown>): void {
  emit('AUTH', event, payload);
}

export function logFirestoreReliability(event: string, payload?: Record<string, unknown>): void {
  emit('FIRESTORE', event, payload);
}

export function logUpload(event: string, payload?: Record<string, unknown>): void {
  emit('UPLOAD', event, payload);
}

export function logSync(event: string, payload?: Record<string, unknown>): void {
  emit('SYNC', event, payload);
}

function isExpectedAuthError(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? '';
  const msg = (error as { message?: string })?.message ?? '';
  return (
    code === 'auth/missing-client-identifier' ||
    code === 'auth/too-many-requests' ||
    code === 'auth/invalid-verification-code' ||
    code === 'auth/code-expired' ||
    code === 'auth/session-expired' ||
    msg.includes('missing-client-identifier') ||
    msg.includes('too-many-requests')
  );
}

export function logReliabilityError(
  tag: ReliabilityTag,
  event: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  // Expected phone-auth failures are shown in Alert — avoid LogBox console.error in dev.
  if (__DEV__ && tag === 'AUTH' && isExpectedAuthError(error)) {
    prodDebug('AUTH', {
      event,
      expected: true,
      code: (error as { code?: string })?.code ?? null,
      message: error instanceof Error ? error.message : String(error),
      ...extra,
    });
    return;
  }
  prodDebugError(`${tag}`, error, { event, ts: Date.now(), ...extra });
}

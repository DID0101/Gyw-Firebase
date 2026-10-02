/** Temporary __DEV__ tracing for call flow (remove when stable). */

export function logCallInitiating(callId: string, extra?: Record<string, unknown>): void {
  if (__DEV__) {
    console.log('[CALL] initiating → callId:', callId, extra ?? {});
  }
}

export function logCallEnding(
  callId: string,
  reason: string,
  extra?: Record<string, unknown>,
): void {
  if (__DEV__) {
    console.log('[CALL] ending → callId:', callId, 'reason:', reason, extra ?? {});
  }
}

export function logCallStatusChanged(
  callId: string,
  oldStatus: string | undefined,
  newStatus: string | undefined,
): void {
  if (__DEV__) {
    console.log('[CALL] status changed:', { callId, old: oldStatus, new: newStatus });
  }
}

export function logCallNavigatingIncoming(payload: Record<string, unknown>): void {
  if (__DEV__) {
    console.log('[CALL] navigating to incoming screen', payload);
  }
}

export function logCallDismissingIncoming(
  reason: string,
  payload?: Record<string, unknown>,
): void {
  if (__DEV__) {
    console.log('[CALL] dismissing incoming screen, reason:', reason, payload ?? {});
  }
}

export function logCallIncomingMounted(payload: Record<string, unknown>): void {
  if (__DEV__) {
    console.log('[CALL] incoming screen mounted, callData:', payload);
  }
}

export function logCallIncomingUnmounted(payload?: Record<string, unknown>): void {
  if (__DEV__) {
    console.log('[CALL] incoming screen unmounted', payload ?? {});
  }
}

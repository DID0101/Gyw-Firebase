/**
 * Opt-in FCM / notification tracing.
 * - Always logs in __DEV__
 * - In release, set `globalThis.__GYW_FCM_DEBUG__ = true` from DevMenu or one-off in app init to trace delivery vs display.
 */
export function isPushDebugEnabled(): boolean {
  if ((globalThis as { __GYW_FCM_DEBUG__?: boolean }).__GYW_FCM_DEBUG__ === true) return true;
  return typeof __DEV__ !== 'undefined' && !!__DEV__;
}

/** Enable verbose push logs in production builds (Metro / dev menu can flip this). */
export function setPushDebugEnabled(enabled: boolean): void {
  (globalThis as { __GYW_FCM_DEBUG__?: boolean }).__GYW_FCM_DEBUG__ = enabled;
}

export function pushDebugLog(tag: string, data: Record<string, unknown>): void {
  if (!isPushDebugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.log(`[push:${tag}]`, JSON.stringify(data));
  } catch {
    // eslint-disable-next-line no-console
    console.log(`[push:${tag}]`, data);
  }
}

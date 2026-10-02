import { useCallManager } from '@/lib/hooks/useCallManager';

/**
 * Mount once under authenticated `(home)`.
 *
 * Incoming navigation: `useCallManager` → `openIncomingCallScreen`.
 * Android: store only (native IncomingCallActivity). iOS: JS incoming route.
 *
 * __DEV__ logs: `[CALL] navigating…` / `dismissing…` in openIncomingCall +
 * useCallManager; mount/unmount in `app/(home)/call/incoming.tsx`.
 */
export function CallManagerHost() {
  useCallManager();
  return null;
}

/**
 * Wraps @react-native-firebase/firestore onSnapshot for dev listener tracking.
 * Catches direct RN Firebase listeners that bypass lib/firestoreNative.snapListen.
 */
import { DebugLogger } from '@/lib/debug/networkAudit/DebugLogger';
import {
  trackListenerAttach,
  trackListenerDetach,
  trackListenerSnapshot,
} from '@/lib/debug/networkAudit/ListenerTracker';
import { recordFirestoreSnapshotMetadata } from '@/lib/debug/networkAudit/FirebaseConnectionMonitor';

let nativePatchInstalled = false;

function resolveNativeRefPath(ref: unknown): string {
  const r = ref as { path?: string };
  if (typeof r?.path === 'string') return r.path;
  return 'native-ref';
}

export function installNativeFirestoreListenerAudit(): void {
  if (!__DEV__ || nativePatchInstalled) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const firestore = require('@react-native-firebase/firestore') as {
      onSnapshot?: (...args: unknown[]) => () => void;
    };
    const original = firestore.onSnapshot;
    if (typeof original !== 'function') return;

    firestore.onSnapshot = (...args: unknown[]) => {
      const ref = args[0];
      const path = resolveNativeRefPath(ref);
      const id = trackListenerAttach(ref, { label: `native:${path}`, stack: new Error().stack });

      const wrappedArgs = [...args];
      const cbIndex = wrappedArgs.findIndex((a, i) => i > 0 && typeof a === 'function');
      if (cbIndex >= 0) {
        const origCb = wrappedArgs[cbIndex] as (snap: unknown) => void;
        wrappedArgs[cbIndex] = (snap: unknown) => {
          trackListenerSnapshot(id, snap);
          const meta = snap as { metadata?: { fromCache?: boolean; hasPendingWrites?: boolean } };
          recordFirestoreSnapshotMetadata({
            fromCache: meta?.metadata?.fromCache,
            hasPendingWrites: meta?.metadata?.hasPendingWrites,
          });
          origCb(snap);
        };
      }

      const unsub = original.apply(firestore, wrappedArgs);
      return () => {
        trackListenerDetach(id);
        unsub();
      };
    };

    nativePatchInstalled = true;
    DebugLogger.logListener('NATIVE_FIRESTORE_LISTENER_AUDIT_INSTALLED', {});
  } catch (err) {
    DebugLogger.warnLeak('NATIVE_FIRESTORE_PATCH_FAILED', { err: String(err) });
  }
}

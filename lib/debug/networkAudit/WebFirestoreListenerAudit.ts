/**
 * Wraps web SDK onSnapshot for dev listener tracking.
 */
import { DebugLogger } from '@/lib/debug/networkAudit/DebugLogger';
import {
  trackListenerAttach,
  trackListenerDetach,
  trackListenerSnapshot,
} from '@/lib/debug/networkAudit/ListenerTracker';
import { recordFirestoreSnapshotMetadata } from '@/lib/debug/networkAudit/FirebaseConnectionMonitor';

let webPatchInstalled = false;

export function installWebFirestoreListenerAudit(): void {
  if (!__DEV__ || webPatchInstalled) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const firestore = require('firebase/firestore') as {
      onSnapshot: (...args: unknown[]) => () => void;
    };
    const original = firestore.onSnapshot;
    if (typeof original !== 'function') return;

    firestore.onSnapshot = (...args: unknown[]) => {
      const ref = args[0];
      const path =
        typeof ref === 'object' && ref && 'path' in ref
          ? String((ref as { path: string }).path)
          : 'web-ref';
      const id = trackListenerAttach(ref, { label: path, stack: new Error().stack });

      const wrappedArgs = [...args];
      const cbIndex = typeof args[1] === 'function' ? 1 : typeof args[2] === 'function' ? 2 : -1;
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

    webPatchInstalled = true;
    DebugLogger.logListener('WEB_FIRESTORE_LISTENER_AUDIT_INSTALLED', {});
  } catch (err) {
    DebugLogger.warnLeak('WEB_FIRESTORE_PATCH_FAILED', { err: String(err) });
  }
}

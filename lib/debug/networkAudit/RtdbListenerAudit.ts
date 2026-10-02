/**
 * Optional RTDB listener audit — only installs if @react-native-firebase/database is present.
 */
import { DebugLogger } from '@/lib/debug/networkAudit/DebugLogger';
import { trackNamedListenerEvent } from '@/lib/debug/networkAudit/ListenerTracker';

let installed = false;

export function installRtdbListenerAudit(): void {
  if (!__DEV__ || installed) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const database = require('@react-native-firebase/database') as {
      default?: () => { ref: (path: string) => RtdbRef };
    };
    const app = database.default?.();
    if (!app?.ref) return;

    const originalRef = app.ref.bind(app);
    app.ref = (path: string) => {
      const ref = originalRef(path);
      return wrapRtdbRef(ref, path);
    };

    installed = true;
    DebugLogger.logListener('RTDB_LISTENER_AUDIT_INSTALLED', {});
  } catch {
    /* RTDB not used in this app */
  }
}

type RtdbRef = {
  on: (event: string, cb: (...args: unknown[]) => void) => () => void;
  off: (event?: string, cb?: (...args: unknown[]) => void) => void;
};

function wrapRtdbRef(ref: RtdbRef, path: string): RtdbRef {
  const originalOn = ref.on.bind(ref);
  ref.on = (event: string, cb: (...args: unknown[]) => void) => {
    trackNamedListenerEvent('START', `rtdb:${path}:${event}`);
    const unsub = originalOn(event, (...args: unknown[]) => {
      DebugLogger.logListener('RTDB_EVENT', { path, event, screen: path });
      cb(...args);
    });
    return () => {
      trackNamedListenerEvent('STOP', `rtdb:${path}:${event}`);
      unsub();
    };
  };
  return ref;
}

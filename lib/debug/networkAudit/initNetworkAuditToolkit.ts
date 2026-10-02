/**
 * Bootstraps all Network Investigation & Audit Toolkit modules (dev only).
 */
import { exposeAuditGlobals, startPeriodicAuditReports } from '@/lib/debug/networkAudit/auditReport';
import { installBackgroundTaskAudit } from '@/lib/debug/networkAudit/BackgroundTaskAudit';
import { DebugLogger } from '@/lib/debug/networkAudit/DebugLogger';
import { startFirestoreConnectionMonitor } from '@/lib/debug/networkAudit/FirebaseConnectionMonitor';
import { installFirebaseWriteAudit } from '@/lib/debug/networkAudit/FirebaseWriteAudit';
import { installImageCacheProfiler } from '@/lib/debug/networkAudit/ImageCacheProfiler';
import { installNativeFirestoreListenerAudit } from '@/lib/debug/networkAudit/NativeFirestoreListenerAudit';
import { startListenerLeakWatcher } from '@/lib/debug/networkAudit/ListenerTracker';
import { installFetchMonitor } from '@/lib/debug/networkAudit/NetworkPayloadMonitor';
import { installPresenceAudit } from '@/lib/debug/networkAudit/PresenceAudit';
import { installRtdbListenerAudit } from '@/lib/debug/networkAudit/RtdbListenerAudit';
import { installTimerScanner } from '@/lib/debug/networkAudit/TimerScanner';
import { installWebFirestoreListenerAudit } from '@/lib/debug/networkAudit/WebFirestoreListenerAudit';

let started = false;

export function initNetworkAuditToolkit(): void {
  if (!__DEV__ || started) return;
  started = true;

  DebugLogger.logReport('INIT_START', {
    message: 'Network Investigation & Audit Toolkit loading — filter Metro with NET_AUDIT',
  });

  installTimerScanner();
  installBackgroundTaskAudit();
  installFetchMonitor();
  installPresenceAudit();
  installFirebaseWriteAudit();
  installImageCacheProfiler();
  installWebFirestoreListenerAudit();
  installNativeFirestoreListenerAudit();
  installRtdbListenerAudit();
  startFirestoreConnectionMonitor();
  startListenerLeakWatcher();
  startPeriodicAuditReports();
  exposeAuditGlobals();

  DebugLogger.logReport('INIT_COMPLETE', {
    modules: [
      'TimerScanner',
      'BackgroundTaskAudit',
      'NetworkPayloadMonitor',
      'PresenceAudit',
      'FirebaseWriteAudit',
      'ImageCacheProfiler',
      'WebFirestoreListenerAudit',
      'NativeFirestoreListenerAudit',
      'RtdbListenerAudit',
      'FirebaseConnectionMonitor',
      'ListenerTracker',
      'auditReport',
    ],
    manualReport: 'Run global.__GYW_AUDIT_REPORT() in Metro/console for instant rollup',
    globals: [
      '__GYW_AUDIT_REPORT',
      '__GYW_AUDIT_LISTENERS',
      '__GYW_AUDIT_NETWORK',
      '__GYW_AUDIT_TIMERS',
      '__GYW_AUDIT_PRESENCE',
    ],
  });
}

export function isNetworkAuditToolkitActive(): boolean {
  return __DEV__ && started;
}

export { DebugLogger } from '@/lib/debug/networkAudit/DebugLogger';
export {
  getAuditScreen,
  setAuditScreen,
  markAuditScreenMount,
  markAuditScreenUnmount,
  getAuditContextSnapshot,
  currentHourBucket,
} from '@/lib/debug/networkAudit/auditContext';
export {
  trackListenerAttach,
  trackListenerDetach,
  trackListenerSnapshot,
  trackNamedListenerEvent,
  getActiveListenerSnapshot,
  getListenerAuditSummary,
  startListenerLeakWatcher,
  stopListenerLeakWatcher,
} from '@/lib/debug/networkAudit/ListenerTracker';
export {
  installFetchMonitor,
  getNetworkPayloadReport,
  logTopNetworkConsumers,
} from '@/lib/debug/networkAudit/NetworkPayloadMonitor';
export {
  installPresenceAudit,
  recordPresenceWrite,
  getPresenceWriteStats,
} from '@/lib/debug/networkAudit/PresenceAudit';
export {
  installTimerScanner,
  getActiveTimersSnapshot,
  logActiveTimersReport,
} from '@/lib/debug/networkAudit/TimerScanner';
export {
  installImageCacheProfiler,
  recordImageRender,
  getImageAuditReport,
  logImageAuditReport,
} from '@/lib/debug/networkAudit/ImageCacheProfiler';
export {
  startFirestoreConnectionMonitor,
  getFirestoreConnectionStats,
  recordFirestoreSnapshotMetadata,
} from '@/lib/debug/networkAudit/FirebaseConnectionMonitor';
export {
  initNetworkAuditToolkit,
  isNetworkAuditToolkitActive,
} from '@/lib/debug/networkAudit/initNetworkAuditToolkit';
export {
  installBackgroundTaskAudit,
} from '@/lib/debug/networkAudit/BackgroundTaskAudit';
export {
  installNativeFirestoreListenerAudit,
} from '@/lib/debug/networkAudit/NativeFirestoreListenerAudit';
export { logFullAuditReport, startPeriodicAuditReports } from '@/lib/debug/networkAudit/auditReport';

/**
 * Rolls up all audit modules into periodic hourly reports.
 */
import { DebugLogger } from '@/lib/debug/networkAudit/DebugLogger';
import { getAuditContextSnapshot, currentHourBucket } from '@/lib/debug/networkAudit/auditContext';
import { getFirestoreConnectionStats } from '@/lib/debug/networkAudit/FirebaseConnectionMonitor';
import { getImageAuditReport, logImageAuditReport } from '@/lib/debug/networkAudit/ImageCacheProfiler';
import { getActiveListenerSnapshot, getListenerAuditSummary } from '@/lib/debug/networkAudit/ListenerTracker';
import { getNetworkPayloadReport, logTopNetworkConsumers } from '@/lib/debug/networkAudit/NetworkPayloadMonitor';
import { getPresenceWriteStats } from '@/lib/debug/networkAudit/PresenceAudit';
import { getActiveTimersSnapshot, logActiveTimersReport } from '@/lib/debug/networkAudit/TimerScanner';

const REPORT_INTERVAL_MS = 60 * 60 * 1000;
const QUICK_REPORT_INTERVAL_MS = 5 * 60 * 1000;

let reportTimer: ReturnType<typeof setInterval> | null = null;
let quickReportTimer: ReturnType<typeof setInterval> | null = null;

export function logFullAuditReport(): void {
  if (!__DEV__) return;

  const listeners = getListenerAuditSummary();
  const activeListeners = getActiveListenerSnapshot();
  const presence = getPresenceWriteStats();
  const firestoreConn = getFirestoreConnectionStats();
  const images = getImageAuditReport();
  const timers = getActiveTimersSnapshot();
  const context = getAuditContextSnapshot();

  DebugLogger.logReport('FULL_AUDIT_REPORT', {
    hour: currentHourBucket(),
    context,
    listeners: {
      ...listeners,
      active: activeListeners.map((l) => ({
        path: l.path,
        screen: l.screen,
        snapshotCount: l.snapshotCount,
        totalSnapshotBytes: l.totalSnapshotBytes,
        ageMs: Date.now() - l.attachedAt,
      })),
    },
    presenceWritesLast60s: presence,
    firestoreConn,
    images: {
      prefetchCount: images.prefetchCount,
      estTotalMB: (images.estTotalBytes / (1024 * 1024)).toFixed(2),
      byScreen: images.byScreen,
    },
    activeIntervals: timers.filter((t) => t.kind === 'interval').length,
  });

  logTopNetworkConsumers(8);
  logActiveTimersReport();
  logImageAuditReport();
}

export function startPeriodicAuditReports(): void {
  if (!__DEV__) return;
  if (reportTimer || quickReportTimer) return;

  DebugLogger.logReport('AUDIT_TOOLKIT_READY', {
    filter: 'NET_AUDIT',
    hourlyReportMs: REPORT_INTERVAL_MS,
    quickReportMs: QUICK_REPORT_INTERVAL_MS,
  });

  quickReportTimer = setInterval(() => {
    logTopNetworkConsumers(5);
  }, QUICK_REPORT_INTERVAL_MS);

  reportTimer = setInterval(() => {
    logFullAuditReport();
  }, REPORT_INTERVAL_MS);
}

export function stopPeriodicAuditReports(): void {
  if (reportTimer) clearInterval(reportTimer);
  if (quickReportTimer) clearInterval(quickReportTimer);
  reportTimer = null;
  quickReportTimer = null;
}

/** Exposed on global for manual Metro console invocation. */
export function exposeAuditGlobals(): void {
  if (!__DEV__ || typeof globalThis === 'undefined') return;
  const g = globalThis as typeof globalThis & {
    __GYW_AUDIT_REPORT?: () => void;
    __GYW_AUDIT_LISTENERS?: () => ReturnType<typeof getListenerAuditSummary>;
    __GYW_AUDIT_NETWORK?: () => ReturnType<typeof getNetworkPayloadReport>;
    __GYW_AUDIT_TIMERS?: () => ReturnType<typeof getActiveTimersSnapshot>;
    __GYW_AUDIT_PRESENCE?: () => ReturnType<typeof getPresenceWriteStats>;
  };
  g.__GYW_AUDIT_REPORT = () => logFullAuditReport();
  g.__GYW_AUDIT_LISTENERS = () => getListenerAuditSummary();
  g.__GYW_AUDIT_NETWORK = () => getNetworkPayloadReport();
  g.__GYW_AUDIT_TIMERS = () => getActiveTimersSnapshot();
  g.__GYW_AUDIT_PRESENCE = () => getPresenceWriteStats();
}

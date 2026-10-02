/**
 * Monitors Firestore connection churn via NetInfo + snapshot metadata heuristics.
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import { DebugLogger } from '@/lib/debug/networkAudit/DebugLogger';
import { currentHourBucket } from '@/lib/debug/networkAudit/auditContext';

const RECONNECT_STORM_THRESHOLD = 5;
const RECONNECT_STORM_WINDOW_MS = 60_000;

let started = false;
let unsubscribe: (() => void) | null = null;
let lastOnline: boolean | null = null;
let lastConnectionType = 'unknown';
const reconnectTimestamps: number[] = [];
let firestoreCacheOnlySnapshots = 0;
let firestoreServerSnapshots = 0;

function pruneReconnectWindow(now: number): void {
  while (reconnectTimestamps.length > 0 && now - reconnectTimestamps[0]! > RECONNECT_STORM_WINDOW_MS) {
    reconnectTimestamps.shift();
  }
}

function checkReconnectStorm(now: number): void {
  pruneReconnectWindow(now);
  if (reconnectTimestamps.length >= RECONNECT_STORM_THRESHOLD) {
    DebugLogger.warnFirestoreConn('FIRESTORE_RECONNECT_STORM', {
      reconnectsIn60s: reconnectTimestamps.length,
      hour: currentHourBucket(),
      message:
        'Network/Firestore reconnecting frequently — each reconnect re-syncs listeners and can consume MBs',
    });
  }
}

function onNetInfo(state: NetInfoState): void {
  const reachable =
    state.isInternetReachable === null
      ? state.isConnected
      : state.isInternetReachable && state.isConnected;
  const online = !!reachable;
  const type = state.type ?? 'unknown';

  if (lastOnline === false && online) {
    const now = Date.now();
    reconnectTimestamps.push(now);
    DebugLogger.logFirestoreConn('NETWORK_RECONNECT', {
      connectionType: type,
      hour: currentHourBucket(),
      reconnectsIn60s: reconnectTimestamps.length,
    });
    checkReconnectStorm(now);
  }

  if (lastOnline === true && !online) {
    DebugLogger.logFirestoreConn('NETWORK_DISCONNECT', {
      connectionType: type,
      hour: currentHourBucket(),
    });
  }

  if (lastConnectionType !== type && lastOnline != null) {
    DebugLogger.logFirestoreConn('CONNECTION_TYPE_CHANGE', {
      from: lastConnectionType,
      to: type,
      online,
    });
  }

  lastOnline = online;
  lastConnectionType = type;
}

export function startFirestoreConnectionMonitor(): void {
  if (!__DEV__ || started) return;
  started = true;
  try {
    unsubscribe = NetInfo.addEventListener(onNetInfo);
    void NetInfo.fetch().then(onNetInfo);
    DebugLogger.logFirestoreConn('MONITOR_STARTED', {});
  } catch (err) {
    DebugLogger.warnFirestoreConn('MONITOR_START_FAILED', { err: String(err) });
  }
}

export function stopFirestoreConnectionMonitor(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
}

/** Called from listener tracker when snapshot metadata is available. */
export function recordFirestoreSnapshotMetadata(meta: { fromCache?: boolean; hasPendingWrites?: boolean }): void {
  if (!__DEV__) return;
  if (meta.fromCache) {
    firestoreCacheOnlySnapshots += 1;
  } else {
    firestoreServerSnapshots += 1;
  }
  const total = firestoreCacheOnlySnapshots + firestoreServerSnapshots;
  if (total > 0 && total % 50 === 0) {
    DebugLogger.logFirestoreConn('SNAPSHOT_SOURCE_RATIO', {
      fromCache: firestoreCacheOnlySnapshots,
      fromServer: firestoreServerSnapshots,
      cacheRatio: (firestoreCacheOnlySnapshots / total).toFixed(2),
      hour: currentHourBucket(),
    });
  }
}

export function getFirestoreConnectionStats(): {
  reconnectsIn60s: number;
  firestoreCacheOnlySnapshots: number;
  firestoreServerSnapshots: number;
} {
  pruneReconnectWindow(Date.now());
  return {
    reconnectsIn60s: reconnectTimestamps.length,
    firestoreCacheOnlySnapshots,
    firestoreServerSnapshots,
  };
}

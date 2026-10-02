/**
 * Production network layer — NetInfo-backed state, poor-connection heuristic, reconnect events.
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import { logNetwork } from '@/lib/reliability/reliabilityLog';
import { refreshSentryNetworkContext } from '@/lib/reliability/SentryManager';

export type NetworkState = {
  isOnline: boolean;
  connectionType: string;
  isPoorConnection: boolean;
  isSlow: boolean;
  reachability: 'online' | 'offline' | 'unknown';
  updatedAt: number;
};

const POOR_TRANSITION_WINDOW_MS = 60_000;
const POOR_TRANSITION_THRESHOLD = 3;

let current: NetworkState = {
  isOnline: true,
  connectionType: 'unknown',
  isPoorConnection: false,
  isSlow: false,
  reachability: 'unknown',
  updatedAt: Date.now(),
};

const stateListeners = new Set<(state: NetworkState) => void>();
const reconnectListeners = new Set<() => void>();
const transitionTimestamps: number[] = [];
let started = false;
let wasOnline = true;
let unsubscribeNetInfo: (() => void) | null = null;

function deriveSlow(state: NetInfoState): boolean {
  const details = state.details as { cellularGeneration?: string; isConnectionExpensive?: boolean } | undefined;
  if (details?.isConnectionExpensive) return true;
  if (state.type === 'cellular' && details?.cellularGeneration) {
    return ['2g', '3g'].includes(details.cellularGeneration);
  }
  return false;
}

function deriveReachable(state: NetInfoState): boolean {
  const reachable =
    state.isInternetReachable === null
      ? state.isConnected
      : state.isInternetReachable && state.isConnected;
  return !!reachable;
}

function recordTransition(): void {
  const now = Date.now();
  transitionTimestamps.push(now);
  while (transitionTimestamps.length > 0 && now - transitionTimestamps[0]! > POOR_TRANSITION_WINDOW_MS) {
    transitionTimestamps.shift();
  }
}

function derivePoorConnection(isSlow: boolean, isOnline: boolean): boolean {
  if (!isOnline) return true;
  if (isSlow) return true;
  return transitionTimestamps.length >= POOR_TRANSITION_THRESHOLD;
}

function applyNetInfoState(state: NetInfoState): void {
  const isOnline = deriveReachable(state);
  const isSlow = deriveSlow(state);
  const connectionType = state.type ?? 'unknown';

  if (
    isOnline !== current.isOnline ||
    isSlow !== current.isSlow ||
    connectionType !== current.connectionType
  ) {
    recordTransition();
  }

  const next: NetworkState = {
    isOnline,
    connectionType,
    isSlow,
    isPoorConnection: derivePoorConnection(isSlow, isOnline),
    reachability: isOnline ? 'online' : 'offline',
    updatedAt: Date.now(),
  };

  const changed =
    next.isOnline !== current.isOnline ||
    next.isPoorConnection !== current.isPoorConnection ||
    next.connectionType !== current.connectionType;

  if (!changed && next.isSlow === current.isSlow) return;

  current = next;
  refreshSentryNetworkContext();

  if (!wasOnline && isOnline) {
    logNetwork('RECONNECT', {
      connectionType,
      isPoorConnection: next.isPoorConnection,
    });
    reconnectListeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
  }

  if (wasOnline && !isOnline) {
    logNetwork('DISCONNECT', { connectionType });
  }

  wasOnline = isOnline;

  stateListeners.forEach((fn) => {
    try {
      fn(next);
    } catch {
      /* ignore */
    }
  });
}

export function getNetworkState(): NetworkState {
  return current;
}

/** @deprecated Use getNetworkState — kept for prior reliability code. */
export function getNetworkQuality() {
  const s = getNetworkState();
  return {
    ...s,
    quality: s.isPoorConnection ? 'poor' : s.isOnline ? 'good' : 'offline',
    latencyMs: null as number | null,
    offlineDurationMs: 0,
    packetLossEstimate: 0,
    isSlow: s.isSlow,
  };
}

export function assertOnlineForOperation(op: string): void {
  if (!current.isOnline) {
    logNetwork('OPERATION_BLOCKED_OFFLINE', { op });
    throw Object.assign(new Error('network_offline'), { code: 'network/offline', op });
  }
}

export function subscribeToNetworkState(listener: (state: NetworkState) => void): () => void {
  ensureStarted();
  stateListeners.add(listener);
  try {
    listener(current);
  } catch {
    /* ignore */
  }
  return () => stateListeners.delete(listener);
}

/** Fires once when NetInfo reports reconnect (offline → online). */
export function subscribeToReconnect(listener: () => void): () => void {
  ensureStarted();
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

function ensureStarted(): void {
  if (started) return;
  started = true;
  logNetwork('MANAGER_START', { ...current });
  try {
    unsubscribeNetInfo = NetInfo.addEventListener(applyNetInfoState);
    void NetInfo.fetch().then(applyNetInfoState);
  } catch {
    /* tests / web */
  }
}

export function startNetworkManager(): void {
  ensureStarted();
}

export function stopNetworkManagerForTests(): void {
  if (unsubscribeNetInfo) unsubscribeNetInfo();
  unsubscribeNetInfo = null;
  started = false;
  wasOnline = true;
  transitionTimestamps.length = 0;
  stateListeners.clear();
  reconnectListeners.clear();
  current = {
    isOnline: true,
    connectionType: 'unknown',
    isPoorConnection: false,
    isSlow: false,
    reachability: 'unknown',
    updatedAt: Date.now(),
  };
}

/**
 * Centralized network state powered by @react-native-community/netinfo.
 *
 * Exposes:
 *   - useNetworkState() — React hook for components
 *   - getNetworkSnapshot() — sync accessor for services / non-React code
 *   - subscribeToNetwork(listener) — fine-grained subscription
 *
 * Designed to be safe to call before the NetInfo listener has produced a
 * value: defaults to "online" so we never block the UI on cold start.
 */

import { logNetworkStateChanged } from '@/lib/perf/productionTelemetry';
import { useEffect, useState } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

export type Reachability = 'online' | 'offline' | 'unknown';

export interface NetworkSnapshot {
  /** Coarse-grained status used by most call-sites. */
  reachability: Reachability;
  /** True when the device claims a usable internet connection. */
  isOnline: boolean;
  /** True when NetInfo flags the link as expensive/weak (or 2g/3g). */
  isSlow: boolean;
  /** Lower-level NetInfo type — useful for diagnostics only. */
  connectionType: string;
  /** Wall-clock ms of the most recent change (Date.now()). */
  updatedAt: number;
}

const initialSnapshot: NetworkSnapshot = {
  reachability: 'unknown',
  isOnline: true,
  isSlow: false,
  connectionType: 'unknown',
  updatedAt: Date.now(),
};

let current: NetworkSnapshot = initialSnapshot;
const listeners = new Set<(snap: NetworkSnapshot) => void>();
let started = false;
let unsubscribeNetInfo: (() => void) | null = null;

function deriveSlow(state: NetInfoState): boolean {
  const details = state.details as { cellularGeneration?: string; isConnectionExpensive?: boolean } | undefined;
  if (details?.isConnectionExpensive) return true;
  if (state.type === 'cellular' && details?.cellularGeneration) {
    return ['2g', '3g'].includes(details.cellularGeneration);
  }
  return false;
}

function applyState(state: NetInfoState) {
  // NetInfo gives `null` for isInternetReachable until the probe completes.
  // Treat that as the device's own `isConnected` value to avoid false "offline"
  // banners during cold start while the probe is still running.
  const reachable =
    state.isInternetReachable === null
      ? state.isConnected
      : state.isInternetReachable && state.isConnected;
  const next: NetworkSnapshot = {
    reachability: reachable ? 'online' : 'offline',
    isOnline: !!reachable,
    isSlow: deriveSlow(state),
    connectionType: state.type ?? 'unknown',
    updatedAt: Date.now(),
  };

  if (
    next.reachability === current.reachability &&
    next.isSlow === current.isSlow &&
    next.connectionType === current.connectionType
  ) {
    return;
  }

  current = next;
  logNetworkStateChanged({
    reachability: next.reachability,
    isSlow: next.isSlow,
    connectionType: next.connectionType,
  });
  listeners.forEach((fn) => {
    try {
      fn(next);
    } catch {
      /* ignore listener errors */
    }
  });
}

function ensureStarted(): void {
  if (started) return;
  started = true;
  try {
    unsubscribeNetInfo = NetInfo.addEventListener(applyState);
    NetInfo.fetch()
      .then(applyState)
      .catch(() => {
        /* fail-open */
      });
  } catch {
    /* NetInfo native module may not be available in tests */
  }
}

export function getNetworkSnapshot(): NetworkSnapshot {
  ensureStarted();
  return current;
}

/** Fresh NetInfo read after foreground — avoids stale offline banner until the listener fires. */
export function refreshNetworkSnapshot(): void {
  ensureStarted();
  NetInfo.fetch()
    .then(applyState)
    .catch(() => {
      /* fail-open */
    });
}

export function subscribeToNetwork(
  listener: (snap: NetworkSnapshot) => void
): () => void {
  ensureStarted();
  listeners.add(listener);
  // Fire once with the current value so callers don't need to do a separate read.
  try {
    listener(current);
  } catch {
    /* ignore */
  }
  return () => {
    listeners.delete(listener);
  };
}

export function useNetworkState(): NetworkSnapshot {
  const [snap, setSnap] = useState<NetworkSnapshot>(() => getNetworkSnapshot());
  useEffect(() => subscribeToNetwork(setSnap), []);
  return snap;
}

/** Resolves once the network reports `online` again, or rejects after `timeoutMs`. */
export function waitForOnline(timeoutMs = 15000): Promise<void> {
  if (getNetworkSnapshot().isOnline) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('network_wait_timeout'));
    }, timeoutMs);
    const unsubscribe = subscribeToNetwork((snap) => {
      if (snap.isOnline) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

/** Manual teardown — only used in tests. Production code should never call this. */
export function __resetNetworkStateForTests(): void {
  if (unsubscribeNetInfo) unsubscribeNetInfo();
  unsubscribeNetInfo = null;
  started = false;
  current = initialSnapshot;
  listeners.clear();
}

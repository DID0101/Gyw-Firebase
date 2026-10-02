/**
 * Observable sync status — drives the OfflineBanner's "Syncing..." / "Up to date" states.
 *
 * QueueSyncManager calls `setSyncPhase` during flush; the banner subscribes via
 * `useSyncStatus` and shows transient feedback without blocking the UI.
 */
import { useEffect, useState } from 'react';

export type SyncPhase =
  | 'idle'
  | 'syncing'
  | 'done'
  | 'error';

export interface SyncSnapshot {
  phase: SyncPhase;
  pendingCount: number;
  updatedAt: number;
}

const initial: SyncSnapshot = { phase: 'idle', pendingCount: 0, updatedAt: Date.now() };
let current: SyncSnapshot = initial;
const listeners = new Set<(snap: SyncSnapshot) => void>();

function notify() {
  listeners.forEach((fn) => {
    try { fn(current); } catch { /* swallow */ }
  });
}

export function setSyncPhase(phase: SyncPhase, pendingCount = 0): void {
  current = { phase, pendingCount, updatedAt: Date.now() };
  notify();
}

export function getSyncSnapshot(): SyncSnapshot {
  return current;
}

export function subscribeToSyncStatus(listener: (snap: SyncSnapshot) => void): () => void {
  listeners.add(listener);
  try { listener(current); } catch { /* swallow */ }
  return () => { listeners.delete(listener); };
}

export function useSyncStatus(): SyncSnapshot {
  const [snap, setSnap] = useState<SyncSnapshot>(() => getSyncSnapshot());
  useEffect(() => subscribeToSyncStatus(setSnap), []);
  return snap;
}

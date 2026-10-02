import { getNetworkSnapshot } from '@/lib/networkState';

/** Recent messages kept per chat on disk (matches listener page cap). */
export const MAX_PERSISTED_MESSAGES_PER_CHAT = 50;

/** In-memory cap per chat (newest-first); allows some scroll-back without unbounded RAM. */
export const MAX_IN_MEMORY_MESSAGES_PER_CHAT = 80;

const FAST_WARM_LIMIT = 30;
const SLOW_WARM_LIMIT = 20;

export function getWarmChatLimit(): number {
  const { isSlow } = getNetworkSnapshot();
  return isSlow ? SLOW_WARM_LIMIT : FAST_WARM_LIMIT;
}

export function getListenerPageSize(): number {
  const { isSlow } = getNetworkSnapshot();
  return isSlow ? SLOW_WARM_LIMIT : FAST_WARM_LIMIT;
}

export function getIdlePreloadChatCount(isLowTierAndroid: boolean): number {
  const { isSlow, isOnline } = getNetworkSnapshot();
  if (!isOnline || isSlow) return 1;
  return isLowTierAndroid ? 2 : 3;
}

export function shouldPrefetchChatRoute(): boolean {
  const { isSlow, isOnline } = getNetworkSnapshot();
  return isOnline && !isSlow;
}

/** Max ms to wait for warm before navigating when cache is empty. */
export function getWarmNavigationWaitMs(): number {
  const { isSlow, isOnline } = getNetworkSnapshot();
  if (!isOnline) return 0;
  return isSlow ? 800 : 500;
}

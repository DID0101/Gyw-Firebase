/**
 * Stale-while-revalidate cache for username/phone search results.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { User } from '@/lib/types/chat';
import { logSync } from '@/lib/reliability/reliabilityLog';

const PREFIX = 'searchCache:v1:';
const TTL_MS = 10 * 60 * 1000;

type CacheEntry = {
  hits: User[];
  cachedAt: number;
};

function keyForQuery(q: string, region: string): string {
  return `${PREFIX}${region}:${q.toLowerCase().trim()}`;
}

export async function getCachedSearch(q: string, region: string): Promise<User[] | null> {
  try {
    const raw = await AsyncStorage.getItem(keyForQuery(q, region));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry?.hits || Date.now() - entry.cachedAt > TTL_MS) return null;
    logSync('SEARCH_CACHE_HIT', { q: q.slice(0, 24), count: entry.hits.length });
    return entry.hits;
  } catch {
    return null;
  }
}

export async function setCachedSearch(q: string, region: string, hits: User[]): Promise<void> {
  try {
    const entry: CacheEntry = { hits, cachedAt: Date.now() };
    await AsyncStorage.setItem(keyForQuery(q, region), JSON.stringify(entry));
    logSync('SEARCH_CACHE_SET', { q: q.slice(0, 24), count: hits.length });
  } catch {
    /* non-fatal */
  }
}

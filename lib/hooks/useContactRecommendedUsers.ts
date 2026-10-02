import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Contacts from 'expo-contacts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { buildPhoneLookupKeys, toE164 } from '@/lib/contacts/phoneNormalization';
import { searchLoadLog } from '@/lib/debug/searchLoadingTrace';
import {
  endHangWatch,
  logScreenLifecycle,
  startHangWatch,
  updateHangWatch,
} from '@/lib/debug/runtimeDiagnostics';
import { getDeviceRegionCode } from '@/lib/phoneNormalize';
import { getUsersByPhoneNumbersIn } from '@/lib/services/userSearchService';
import type { User } from '@/lib/types/chat';
import { useContactsStore } from '@/store/contactsStore';
import type { CountryCode } from 'libphonenumber-js';

type Permission = 'pending' | 'granted' | 'denied';

const MAX_FIRESTORE_PHONE_KEYS = 600;
const SYNC_TIMEOUT_MS = 30_000;
const RECOMMENDED_CACHE_TTL_MS = 5 * 60 * 1000;
const RECOMMENDED_DISK_KEY = 'recommendedUsersCache:v1';
/** Show UI after first N phone-key chunks (30 keys each). */
const PROGRESSIVE_BATCH_CHUNKS = 2;

function sortByName(list: User[]): User[] {
  return [...list].sort((a, b) => {
    const an = `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.username || '';
    const bn = `${b.firstName || ''} ${b.lastName || ''}`.trim() || b.username || '';
    return an.localeCompare(bn, undefined, { sensitivity: 'base' });
  });
}

type ContactRow = { phoneNumbers?: { number?: string }[] };

function dedupeContactPhoneRaws(rows: ContactRow[], region: CountryCode): string[] {
  const byLogical = new Map<string, string>();
  for (const row of rows) {
    for (const pn of row.phoneNumbers ?? []) {
      const raw = pn.number?.trim();
      if (!raw) continue;
      const e164 = toE164(raw, region);
      const key = e164 ?? raw.replace(/\D/g, '');
      if (key.length < 7) continue;
      if (!byLogical.has(key)) byLogical.set(key, raw);
    }
  }
  return [...byLogical.values()];
}

function buildFirestorePhoneKeys(
  dedupedRaws: string[],
  region: CountryCode,
  currentPhone: string | null | undefined
): string[] {
  const out = new Set<string>();

  for (const raw of dedupedRaws) {
    for (const k of buildPhoneLookupKeys(raw, region)) {
      if (out.size >= MAX_FIRESTORE_PHONE_KEYS) break;
      out.add(k);
    }
    if (out.size >= MAX_FIRESTORE_PHONE_KEYS) break;
  }

  if (currentPhone) {
    for (const x of buildPhoneLookupKeys(currentPhone, region)) {
      out.delete(x);
    }
  }

  return [...out];
}

function keysFromContactsCache(
  region: CountryCode,
  currentPhone: string | null | undefined
): string[] {
  const { phoneToName, permission } = useContactsStore.getState();
  if (permission !== 'granted' || Object.keys(phoneToName).length === 0) {
    return [];
  }
  const out = new Set<string>();
  for (const key of Object.keys(phoneToName)) {
    if (out.size >= MAX_FIRESTORE_PHONE_KEYS) break;
    out.add(key);
  }
  if (currentPhone) {
    for (const x of buildPhoneLookupKeys(currentPhone, region)) {
      out.delete(x);
    }
  }
  return [...out];
}

type RecommendedCache = {
  uid: string;
  phoneKey: string;
  users: User[];
  at: number;
};

let recommendedCache: RecommendedCache | null = null;

async function readRecommendedDiskCache(
  cacheKey: string
): Promise<RecommendedCache | null> {
  try {
    const raw = await AsyncStorage.getItem(RECOMMENDED_DISK_KEY);
    if (!raw) return null;
    const hit = JSON.parse(raw) as RecommendedCache;
    if (`${hit.uid}:${hit.phoneKey}` !== cacheKey) return null;
    if (Date.now() - hit.at > RECOMMENDED_CACHE_TTL_MS) return null;
    return hit;
  } catch {
    return null;
  }
}

async function writeRecommendedDiskCache(entry: RecommendedCache): Promise<void> {
  try {
    await AsyncStorage.setItem(RECOMMENDED_DISK_KEY, JSON.stringify(entry));
  } catch {
    /* non-fatal */
  }
}

function mergeRecommendedUsers(
  fetched: User[],
  currentUid: string
): User[] {
  const byUid = new Map<string, User>();
  for (const u of fetched) {
    if (u.uid !== currentUid && u.phoneNumber?.trim()) {
      byUid.set(u.uid, u);
    }
  }
  return sortByName([...byUid.values()]);
}

export function prefetchRecommendedUsers(
  currentUid: string | undefined,
  currentPhone: string | null | undefined
): void {
  if (!currentUid || Platform.OS === 'web') return;
  void useContactsStore.getState().hydrateFromStorage();
  void useContactsStore.getState().refreshContactsIfStale();
}

/**
 * App users whose stored phone matches a number from the device address book.
 */
export function useContactRecommendedUsers(
  currentUid: string | undefined,
  currentPhone: string | null | undefined
) {
  const region = useMemo(() => getDeviceRegionCode() as CountryCode, []);
  const [permission, setPermission] = useState<Permission>('pending');
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [contactRows, setContactRows] = useState(0);
  const [phoneLines, setPhoneLines] = useState(0);
  const syncGen = useRef(0);
  const hasShownUsers = useRef(false);

  const finishLoading = useCallback((reason: string) => {
    setLoading((prev) => {
      if (!prev) return prev;
      searchLoadLog('LOADING_END', { source: 'recommended', reason });
      return false;
    });
  }, []);

  const sync = useCallback(async () => {
    const gen = ++syncGen.current;

    if (Platform.OS === 'web') {
      logScreenLifecycle('ContactsRecommendation', 'QUERY_BLOCKED', { reason: 'web' });
      setPermission('denied');
      setUsers([]);
      setContactRows(0);
      setPhoneLines(0);
      searchLoadLog('SEARCH_INITIALIZATION_SUCCESS', { recommended: 0, platform: 'web' });
      finishLoading('web');
      return;
    }

    if (!currentUid) {
      setUsers([]);
      logScreenLifecycle('ContactsRecommendation', 'QUERY_BLOCKED', { reason: 'no_uid' });
      searchLoadLog('SEARCH_INITIALIZATION_FAILED', { reason: 'no_uid' });
      finishLoading('no_uid');
      return;
    }

    const cacheKey = `${currentUid}:${currentPhone ?? ''}`;
    const memCached = recommendedCache;
    const hadMemoryCache =
      !!memCached &&
      `${memCached.uid}:${memCached.phoneKey}` === cacheKey &&
      Date.now() - memCached.at < RECOMMENDED_CACHE_TTL_MS;

    if (hadMemoryCache) {
      setUsers(memCached!.users);
      setPermission('granted');
      searchLoadLog('SEARCH_INITIALIZATION_SUCCESS', {
        recommended: memCached!.users.length,
        source: 'memory_cache',
      });
      searchLoadLog('RECOMMENDED_COUNT', { count: memCached!.users.length, source: 'memory_cache' });
      finishLoading('memory_cache');
      if (memCached!.users.length > 0) hasShownUsers.current = true;
      return;
    }

    const diskCached = await readRecommendedDiskCache(cacheKey);
    if (gen !== syncGen.current) return;
    if (diskCached && diskCached.users.length > 0) {
      recommendedCache = diskCached;
      setUsers(diskCached.users);
      setPermission('granted');
      searchLoadLog('SEARCH_INITIALIZATION_SUCCESS', {
        recommended: diskCached.users.length,
        source: 'disk_cache',
      });
      finishLoading('disk_cache');
      hasShownUsers.current = true;
      return;
    }

    if (!hasShownUsers.current) {
      setLoading(true);
      searchLoadLog('LOADING_START', { source: 'recommended' });
    }

    searchLoadLog('SEARCH_INITIALIZATION_START', { uid: currentUid.slice(0, 8) });
    searchLoadLog('RECOMMENDED_USERS_START');
    searchLoadLog('CONTACT_SYNC_START');
    logScreenLifecycle('ContactsRecommendation', 'QUERY_START', {
      authUid: currentUid,
      region,
      hasMemoryCache: hadMemoryCache,
    });

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      timeoutId = setTimeout(() => {
        if (gen === syncGen.current) {
          searchLoadLog('SEARCH_TIMEOUT_10S', { ms: SYNC_TIMEOUT_MS });
          updateHangWatch('contacts.recommended', { lastFailedEvent: 'contacts_timeout_10s' });
          finishLoading('timeout_10s');
        }
      }, SYNC_TIMEOUT_MS);

      searchLoadLog('CONTACTS_LOAD_START');
      await useContactsStore.getState().hydrateFromStorage();
      if (gen !== syncGen.current) return;

      let granted = useContactsStore.getState().permission === 'granted';
      if (!granted) {
        const perm = (await Contacts.getPermissionsAsync()).granted;
        granted = perm || (await Contacts.requestPermissionsAsync()).granted;
      }

      searchLoadLog('CONTACT_PERMISSION_STATUS', { granted });
      logScreenLifecycle('ContactsRecommendation', 'PERMISSION_RESULT', { granted });

      if (!granted) {
        if (gen !== syncGen.current) return;
        setPermission('denied');
        setUsers([]);
        setContactRows(0);
        setPhoneLines(0);
        searchLoadLog('CONTACTS_LOAD_COMPLETE', { permission: 'denied' });
        searchLoadLog('CONTACT_SYNC_COMPLETE', { keys: 0, reason: 'permission_denied' });
        searchLoadLog('RECOMMENDED_USERS_EMPTY', { reason: 'permission_denied' });
        searchLoadLog('RECOMMENDED_COUNT', { count: 0 });
        searchLoadLog('SEARCH_INITIALIZATION_SUCCESS', { recommended: 0, permission: 'denied' });
        updateHangWatch('contacts.recommended', { lastSuccessfulEvent: 'permission_denied' });
        return;
      }

      if (gen !== syncGen.current) return;
      setPermission('granted');

      let keys = keysFromContactsCache(region, currentPhone ?? undefined);
      let rows = 0;

      if (keys.length > 0) {
        rows = Object.keys(useContactsStore.getState().phoneToName).length;
        setContactRows(rows);
        setPhoneLines(keys.length);
        searchLoadLog('CONTACTS_LOAD_COMPLETE', { source: 'cache', keys: keys.length, rows });
      } else {
        await useContactsStore.getState().refreshContactsIfStale();
        if (gen !== syncGen.current) return;
        keys = keysFromContactsCache(region, currentPhone ?? undefined);
        if (keys.length > 0) {
          rows = Object.keys(useContactsStore.getState().phoneToName).length;
          setContactRows(rows);
          setPhoneLines(keys.length);
          searchLoadLog('CONTACTS_LOAD_COMPLETE', { source: 'store_refresh', keys: keys.length });
        }
      }

      if (keys.length === 0) {
        setUsers([]);
        logScreenLifecycle('ContactsRecommendation', 'QUERY_RESULT', {
          count: 0,
          reason: 'no_keys',
          contactRows: rows,
          phoneLines: keys.length,
        });
        updateHangWatch('contacts.recommended', { lastSuccessfulEvent: 'no_keys' });
        searchLoadLog('CONTACT_SYNC_COMPLETE', { keys: 0, reason: 'no_keys' });
        searchLoadLog('RECOMMENDED_USERS_EMPTY', { reason: 'no_keys' });
        searchLoadLog('RECOMMENDED_COUNT', { count: 0 });
        searchLoadLog('SEARCH_INITIALIZATION_SUCCESS', { recommended: 0, permission: 'granted' });
        return;
      }

      searchLoadLog('CONTACT_SYNC_COMPLETE', { keys: keys.length, rows });

      searchLoadLog('CONTACT_SYNC_COUNT', { keys: keys.length, rows });
      searchLoadLog('CONTACT_MATCH_START', { keys: keys.length });
      searchLoadLog('USERS_COLLECTION_FETCH_START', { keys: keys.length });

      let progressiveDone = false;
      let lastProgressiveKey = '';
      const fetched = await getUsersByPhoneNumbersIn(keys, currentUid, undefined, (batchUsers, batchIdx, totalBatches) => {
        if (gen !== syncGen.current) return;
        const next = mergeRecommendedUsers(batchUsers, currentUid);
        const nextKey = next.map((u) => u.uid).join(',');
        if (nextKey !== lastProgressiveKey) {
          lastProgressiveKey = nextKey;
          setUsers(next);
        }
        if (!progressiveDone && (next.length > 0 || batchIdx >= PROGRESSIVE_BATCH_CHUNKS || batchIdx >= totalBatches)) {
          progressiveDone = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          if (next.length > 0) hasShownUsers.current = true;
          finishLoading('progressive_batch');
          searchLoadLog('RECOMMENDED_PROGRESSIVE', { batchIdx, totalBatches, count: next.length });
        }
      });
      if (gen !== syncGen.current) return;

      searchLoadLog('USERS_COLLECTION_FETCH_COMPLETE', { fetched: fetched.length });
      searchLoadLog('CONTACT_MATCH_COMPLETE', { matched: fetched.length });
      const next = mergeRecommendedUsers(fetched, currentUid);
      setUsers(next);
      if (next.length > 0) hasShownUsers.current = true;

      logScreenLifecycle('ContactsRecommendation', 'QUERY_RESULT', {
        count: next.length,
        keys: keys.length,
      });
      updateHangWatch('contacts.recommended', { lastSuccessfulEvent: `matches:${next.length}` });

      const cacheEntry: RecommendedCache = {
        uid: currentUid,
        phoneKey: currentPhone ?? '',
        users: next,
        at: Date.now(),
      };
      recommendedCache = cacheEntry;
      void writeRecommendedDiskCache(cacheEntry);

      if (next.length > 0) {
        searchLoadLog('RECOMMENDED_USERS_SUCCESS', { count: next.length });
      } else {
        searchLoadLog('RECOMMENDED_USERS_EMPTY', { reason: 'no_firestore_matches' });
      }
      searchLoadLog('RECOMMENDED_COUNT', { count: next.length });
      searchLoadLog('CONTACT_RECOMMENDATION_RESULT', { count: next.length });
      searchLoadLog('SEARCH_INITIALIZATION_SUCCESS', {
        recommended: next.length,
        permission: 'granted',
      });
    } catch (e) {
      if (gen === syncGen.current) {
        setUsers([]);
        const message = e instanceof Error ? e.message : String(e);
        logScreenLifecycle('ContactsRecommendation', 'QUERY_ERROR', { message });
        updateHangWatch('contacts.recommended', { lastFailedEvent: message });
        searchLoadLog('CONTACT_SYNC_FAILED', { message });
        searchLoadLog('RECOMMENDED_USERS_FAILED', { message });
        searchLoadLog('RECOMMENDED_COUNT', { count: 0 });
        searchLoadLog('SEARCH_INITIALIZATION_FAILED', { message });
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      finishLoading('sync_finally');
    }
  }, [currentPhone, currentUid, finishLoading, region]);

  useEffect(() => {
    void sync();
  }, [sync]);

  useEffect(() => {
    if (loading) {
      startHangWatch('contacts.recommended', 'ContactsRecommendation', {
        lastSuccessfulEvent: 'loading_started',
        timeoutMs: 8_000,
      });
    } else {
      endHangWatch('contacts.recommended', 'loading_false');
    }
  }, [loading]);

  return {
    region,
    permission,
    loading,
    users,
    contactRows,
    phoneLines,
  };
}

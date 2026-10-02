import { Platform } from 'react-native';
import { collection, getDocs, query, where } from 'firebase/firestore';

import { toE164, phonesMatch } from '@/lib/contacts/phoneNormalization';
import {
  firestoreErrorFields,
  searchLoadLog,
  searchLoadBumpQueryCount,
  searchLoadSetActiveListeners,
} from '@/lib/debug/searchLoadingTrace';
import {
  getRuntimeQueryState,
  logFirestoreQuery,
  logSilentEmptyState,
  waitForRuntimeReadyForQueries,
} from '@/lib/debug/runtimeDiagnostics';
import { db } from '@/lib/firebase';
import { hasNativeFirestore } from '@/lib/firestoreNative';
import { getRnFirestore } from '@/lib/rnFirebase';
import { looksLikePhoneQuery, phoneQueryCandidates, getDeviceRegionCode } from '@/lib/phoneNormalize';
import type { CountryCode } from 'libphonenumber-js';
import { User } from '@/lib/types/chat';
import { normalizeForSearch } from '@/lib/unicodeText';

const PHONE_IN_CHUNK = 30;
const PHONE_IN_CONCURRENCY = 4;
const SEARCH_NETWORK_TIMEOUT_MS = 10_000;
const SEARCH_MAX_RETRIES = 2;
const RESULT_CACHE_TTL_MS = 60_000;

let activePhoneListeners = 0;

type CacheEntry = { users: User[]; at: number };
const resultCache = new Map<string, CacheEntry>();
const phoneInResultCache = new Map<string, CacheEntry>();
const phoneInInflight = new Map<string, Promise<User[]>>();

function mapUserDoc(id: string, data: Record<string, any>): User {
  return {
    uid: id,
    ...data,
    createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
  } as User;
}

function searchCacheKey(input: string, excludeUid: string | undefined, region: CountryCode): string {
  return `${excludeUid ?? ''}:${region}:${normalizeForSearch(input.trim())}`;
}

function readCache(key: string): User[] | null {
  const hit = resultCache.get(key);
  if (!hit || Date.now() - hit.at > RESULT_CACHE_TTL_MS) return null;
  searchLoadLog('SEARCH_CACHE_HIT', { key: key.slice(0, 48) });
  return hit.users;
}

function writeCache(key: string, users: User[]): void {
  resultCache.set(key, { users, at: Date.now() });
}

function phoneInCacheKey(phoneValues: string[], excludeUid: string | undefined, region: CountryCode): string {
  return `${excludeUid ?? ''}:${region}:${[...new Set(phoneValues.filter(Boolean))].sort().join('|')}`;
}

function readPhoneInCache(key: string): User[] | null {
  const hit = phoneInResultCache.get(key);
  if (!hit || Date.now() - hit.at > RESULT_CACHE_TTL_MS) return null;
  searchLoadLog('SEARCH_CACHE_HIT', { scope: 'phone_in', key: key.slice(0, 48), count: hit.users.length });
  return hit.users;
}

function writePhoneInCache(key: string, users: User[]): void {
  phoneInResultCache.set(key, { users, at: Date.now() });
}

async function withSearchNetwork<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= SEARCH_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        searchLoadLog('SEARCH_RETRY', { attempt, label });
      }
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('SEARCH_TIMEOUT')), SEARCH_NETWORK_TIMEOUT_MS);
        }),
      ]);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'SEARCH_TIMEOUT') {
        searchLoadLog('SEARCH_TIMEOUT', { label, attempt });
      }
      if (attempt >= SEARCH_MAX_RETRIES) break;
    }
  }
  searchLoadLog('SEARCH_NETWORK_FAIL', {
    label,
    message: lastErr instanceof Error ? lastErr.message : String(lastErr),
  });
  throw lastErr;
}

function usernameQueryCandidates(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const out = new Set<string>();
  out.add(trimmed);
  const folded = normalizeForSearch(trimmed);
  if (folded) out.add(folded);
  const lower = trimmed.toLowerCase();
  out.add(lower);
  return [...out];
}

async function getUsersByPhoneChunkWeb(
  chunk: string[],
  excludeUid: string | undefined,
  byId: Map<string, User>
): Promise<void> {
  const startedAtMs = Date.now();
  const whereClause = [{ field: 'phoneNumber', op: 'in', valueCount: chunk.length }];
  logFirestoreQuery({
    collection: 'users',
    where: whereClause,
    event: 'GET_START',
    op: 'phone_in_web',
    provider: 'web',
    screen: 'SearchOrContacts',
    expectedResultCount: '0..chunkSize',
    startedAtMs,
  });
  searchLoadLog('SEARCH_FIRESTORE_REQUEST', { platform: 'web', chunkSize: chunk.length });
  searchLoadLog('CONTACT_BATCH_QUERY', { size: chunk.length });
  const usersRef = collection(db, 'users');
  const snap = await getDocs(query(usersRef, where('phoneNumber', 'in', chunk)));
  let count = 0;
  snap.docs.forEach((d) => {
    const u = mapUserDoc(d.id, d.data() as Record<string, any>);
    if (!excludeUid || u.uid !== excludeUid) {
      byId.set(u.uid, u);
      count += 1;
    }
  });
  logFirestoreQuery({
    collection: 'users',
    where: whereClause,
    event: 'GET_RESULT',
    op: 'phone_in_web',
    provider: 'web',
    screen: 'SearchOrContacts',
    expectedResultCount: '0..chunkSize',
    actualResultCount: count,
    startedAtMs,
  });
  if (count === 0) {
    logSilentEmptyState('SearchOrContacts', {
      collection: 'users',
      where: whereClause,
      lastSuccessfulEvent: 'phone_in_web_empty',
    });
  }
  searchLoadLog('SEARCH_FIRESTORE_RESPONSE', { docs: count });
  if (count === 0) searchLoadLog('FIRESTORE_SEARCH_EMPTY', { chunkSize: chunk.length });
  else searchLoadLog('FIRESTORE_SEARCH_SUCCESS', { docs: count });
}

async function getUsersByPhoneChunkNative(
  chunk: string[],
  excludeUid: string | undefined,
  byId: Map<string, User>
): Promise<void> {
  const firestore = require('@react-native-firebase/firestore');
  const nativeDb = getRnFirestore();
  const startedAtMs = Date.now();
  const whereClause = [{ field: 'phoneNumber', op: 'in', valueCount: chunk.length }];
  logFirestoreQuery({
    collection: 'users',
    where: whereClause,
    event: 'GET_START',
    op: 'phone_in_native',
    provider: 'native',
    screen: 'SearchOrContacts',
    expectedResultCount: '0..chunkSize',
    startedAtMs,
  });
  searchLoadLog('SEARCH_FIRESTORE_REQUEST', { platform: 'native', chunkSize: chunk.length });
  searchLoadLog('CONTACT_BATCH_QUERY', { size: chunk.length });
  const snap = await firestore.getDocs(
    firestore.query(
      firestore.collection(nativeDb, 'users'),
      firestore.where('phoneNumber', 'in', chunk)
    )
  );
  let count = 0;
  snap.forEach((d: any) => {
    const u = mapUserDoc(d.id, d.data() as Record<string, any>);
    if (!excludeUid || u.uid !== excludeUid) {
      byId.set(u.uid, u);
      count += 1;
    }
  });
  logFirestoreQuery({
    collection: 'users',
    where: whereClause,
    event: 'GET_RESULT',
    op: 'phone_in_native',
    provider: 'native',
    screen: 'SearchOrContacts',
    expectedResultCount: '0..chunkSize',
    actualResultCount: count,
    startedAtMs,
  });
  if (count === 0) {
    logSilentEmptyState('SearchOrContacts', {
      collection: 'users',
      where: whereClause,
      lastSuccessfulEvent: 'phone_in_native_empty',
    });
  }
  searchLoadLog('SEARCH_FIRESTORE_RESPONSE', { docs: count });
  if (count === 0) searchLoadLog('FIRESTORE_SEARCH_EMPTY', { chunkSize: chunk.length });
  else searchLoadLog('FIRESTORE_SEARCH_SUCCESS', { docs: count });
}

export type PhoneBatchProgress = (users: User[], batchIndex: number, totalBatches: number) => void;

async function runPhoneChunks<T>(
  chunks: T[],
  worker: (chunk: T, index: number) => Promise<void>,
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  if (chunks.length === 0) return;
  let completed = 0;
  let nextIndex = 0;
  const pool = Math.min(PHONE_IN_CONCURRENCY, chunks.length);

  await Promise.all(
    Array.from({ length: pool }, async () => {
      while (nextIndex < chunks.length) {
        const index = nextIndex++;
        await worker(chunks[index]!, index);
        completed += 1;
        onProgress?.(completed, chunks.length);
      }
    })
  );
}

async function getUsersByPhoneInWeb(
  phoneValues: string[],
  excludeUid?: string,
  typedE164?: string | null,
  onBatch?: PhoneBatchProgress
): Promise<User[]> {
  const uniq = [...new Set(phoneValues.filter(Boolean))];
  if (uniq.length === 0) return [];
  const byId = new Map<string, User>();

  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += PHONE_IN_CHUNK) {
    chunks.push(uniq.slice(i, i + PHONE_IN_CHUNK));
  }

  searchLoadLog('FIRESTORE_SEARCH_START', { chunks: chunks.length, keys: uniq.length });

  let lastReportedCount = 0;
  await runPhoneChunks(chunks, async (chunk) => {
    try {
      await withSearchNetwork('phone_in_web', () =>
        getUsersByPhoneChunkWeb(chunk, excludeUid, byId)
      );
    } catch (e) {
      logFirestoreQuery({
        collection: 'users',
        where: [{ field: 'phoneNumber', op: 'in', valueCount: chunk.length }],
        event: 'GET_ERROR',
        op: 'phone_in_web',
        provider: 'web',
        screen: 'SearchOrContacts',
        permissionError: e,
      });
      searchLoadLog('SEARCH_FIRESTORE_ERROR', {
        op: 'phone_in_web',
        chunkSize: chunk.length,
        ...firestoreErrorFields(e),
      });
    }
  }, (completed, total) => {
    const size = byId.size;
    if (!onBatch) return;
    if (size !== lastReportedCount || completed >= total) {
      lastReportedCount = size;
      onBatch([...byId.values()], completed, total);
    }
  });

  const users = [...byId.values()];
  logPhoneMatchResults(users, typedE164, getDeviceRegionCode());
  return users;
}

async function getUsersByPhoneInNative(
  phoneValues: string[],
  excludeUid?: string,
  typedE164?: string | null,
  onBatch?: PhoneBatchProgress
): Promise<User[]> {
  const uniq = [...new Set(phoneValues.filter(Boolean))];
  if (uniq.length === 0) return [];
  const byId = new Map<string, User>();

  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += PHONE_IN_CHUNK) {
    chunks.push(uniq.slice(i, i + PHONE_IN_CHUNK));
  }

  searchLoadLog('FIRESTORE_SEARCH_START', { chunks: chunks.length, keys: uniq.length });

  let lastReportedCount = 0;
  await runPhoneChunks(chunks, async (chunk) => {
    try {
      await withSearchNetwork('phone_in_native', () =>
        getUsersByPhoneChunkNative(chunk, excludeUid, byId)
      );
    } catch (e) {
      logFirestoreQuery({
        collection: 'users',
        where: [{ field: 'phoneNumber', op: 'in', valueCount: chunk.length }],
        event: 'GET_ERROR',
        op: 'phone_in_native',
        provider: 'native',
        screen: 'SearchOrContacts',
        permissionError: e,
      });
      searchLoadLog('SEARCH_FIRESTORE_ERROR', {
        op: 'phone_in_native',
        chunkSize: chunk.length,
        ...firestoreErrorFields(e),
      });
    }
  }, (completed, total) => {
    const size = byId.size;
    if (!onBatch) return;
    if (size !== lastReportedCount || completed >= total) {
      lastReportedCount = size;
      onBatch([...byId.values()], completed, total);
    }
  });

  const users = [...byId.values()];
  logPhoneMatchResults(users, typedE164, getDeviceRegionCode());
  return users;
}

function logPhoneMatchResults(
  users: User[],
  typedE164: string | null | undefined,
  region: CountryCode
): void {
  if (!typedE164) return;
  for (const u of users) {
    const storedE164 = toE164(u.phoneNumber, region);
    searchLoadLog('PHONE_NORMALIZED', { uid: u.uid, stored: u.phoneNumber, e164: storedE164 });
    if (phonesMatch(u.phoneNumber, typedE164, region)) {
      searchLoadLog('PHONE_SEARCH_MATCH', { uid: u.uid });
    }
  }
  if (users.length === 0) {
    searchLoadLog('PHONE_SEARCH_MISS', { typedE164 });
  }
}

export async function getUsersByPhoneNumbersIn(
  phoneValues: string[],
  excludeUid?: string,
  typedInput?: string,
  onBatch?: PhoneBatchProgress
): Promise<User[]> {
  const uniq = [...new Set(phoneValues.filter(Boolean))];
  if (uniq.length === 0) return [];

  const ready = await waitForRuntimeReadyForQueries();
  const runtime = getRuntimeQueryState();
  if (!ready) {
    logFirestoreQuery({
      collection: 'users',
      where: [{ field: 'phoneNumber', op: 'in', valueCount: uniq.length }],
      event: 'BLOCKED_BEFORE_READY',
      op: 'getUsersByPhoneNumbersIn',
      provider: Platform.OS !== 'web' && hasNativeFirestore ? 'native' : 'web',
      screen: 'SearchOrContacts',
      extra: {
        firebaseReady: runtime.firebaseReady,
        firebaseProvider: runtime.firebaseProvider,
        authReady: runtime.authReady,
        authUid: runtime.authUid,
      },
    });
    return [];
  }

  const region = getDeviceRegionCode();
  const cacheKey = phoneInCacheKey(uniq, excludeUid, region);
  const cached = readPhoneInCache(cacheKey);
  if (cached) return cached;
  const inflight = phoneInInflight.get(cacheKey);
  if (inflight) {
    searchLoadLog('SEARCH_CACHE_HIT', { scope: 'phone_in_inflight', key: cacheKey.slice(0, 48) });
    return inflight;
  }

  const typedE164 = typedInput ? toE164(typedInput, region) : null;
  if (typedE164) {
    searchLoadLog('PHONE_NORMALIZED', { typed: typedInput, e164: typedE164 });
  }

  searchLoadBumpQueryCount();
  activePhoneListeners += 1;
  searchLoadSetActiveListeners(activePhoneListeners);

  const request = (async () => {
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      return await getUsersByPhoneInNative(uniq, excludeUid, typedE164, onBatch);
    }
    return await getUsersByPhoneInWeb(uniq, excludeUid, typedE164, onBatch);
  })();
  phoneInInflight.set(cacheKey, request);

  try {
    const users = await request;
    writePhoneInCache(cacheKey, users);
    return users;
  } finally {
    phoneInInflight.delete(cacheKey);
    activePhoneListeners = Math.max(0, activePhoneListeners - 1);
    searchLoadSetActiveListeners(activePhoneListeners);
  }
}

async function getUserByUsernameWeb(username: string, excludeUid?: string): Promise<User | null> {
  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('username', '==', username));
  const startedAtMs = Date.now();
  const whereClause = [{ field: 'username', op: '==', value: username }];
  logFirestoreQuery({
    collection: 'users',
    where: whereClause,
    event: 'GET_START',
    op: 'username_web',
    provider: 'web',
    screen: 'Search',
    expectedResultCount: '0..1',
    startedAtMs,
  });
  searchLoadLog('SEARCH_FIRESTORE_REQUEST', { field: 'username', value: username });
  let snap: Awaited<ReturnType<typeof getDocs>>;
  try {
    snap = await withSearchNetwork('username_web', () => getDocs(q));
  } catch (e) {
    logFirestoreQuery({
      collection: 'users',
      where: whereClause,
      event: 'GET_ERROR',
      op: 'username_web',
      provider: 'web',
      screen: 'Search',
      expectedResultCount: '0..1',
      permissionError: e,
      startedAtMs,
    });
    throw e;
  }
  if (snap.empty) {
    logFirestoreQuery({
      collection: 'users',
      where: whereClause,
      event: 'GET_RESULT',
      op: 'username_web',
      provider: 'web',
      screen: 'Search',
      expectedResultCount: '0..1',
      actualResultCount: 0,
      startedAtMs,
    });
    logSilentEmptyState('Search', {
      collection: 'users',
      where: whereClause,
      lastSuccessfulEvent: 'username_web_empty',
    });
    searchLoadLog('FIRESTORE_SEARCH_EMPTY', { field: 'username' });
    return null;
  }
  const d = snap.docs[0];
  const u = mapUserDoc(d.id, d.data() as Record<string, any>);
  logFirestoreQuery({
    collection: 'users',
    where: whereClause,
    event: 'GET_RESULT',
    op: 'username_web',
    provider: 'web',
    screen: 'Search',
    expectedResultCount: '0..1',
    actualResultCount: snap.docs.length,
    startedAtMs,
  });
  searchLoadLog('FIRESTORE_SEARCH_SUCCESS', { field: 'username', uid: u.uid });
  if (excludeUid && u.uid === excludeUid) return null;
  return u;
}

async function getUserByUsernameNative(username: string, excludeUid?: string): Promise<User | null> {
  const firestore = require('@react-native-firebase/firestore');
  const nativeDb = getRnFirestore();
  const q = firestore.query(
    firestore.collection(nativeDb, 'users'),
    firestore.where('username', '==', username)
  );
  const startedAtMs = Date.now();
  const whereClause = [{ field: 'username', op: '==', value: username }];
  logFirestoreQuery({
    collection: 'users',
    where: whereClause,
    event: 'GET_START',
    op: 'username_native',
    provider: 'native',
    screen: 'Search',
    expectedResultCount: '0..1',
    startedAtMs,
  });
  searchLoadLog('SEARCH_FIRESTORE_REQUEST', { field: 'username', value: username });
  let snap: any;
  try {
    snap = await withSearchNetwork('username_native', () => firestore.getDocs(q));
  } catch (e) {
    logFirestoreQuery({
      collection: 'users',
      where: whereClause,
      event: 'GET_ERROR',
      op: 'username_native',
      provider: 'native',
      screen: 'Search',
      expectedResultCount: '0..1',
      permissionError: e,
      startedAtMs,
    });
    throw e;
  }
  if (snap.empty) {
    logFirestoreQuery({
      collection: 'users',
      where: whereClause,
      event: 'GET_RESULT',
      op: 'username_native',
      provider: 'native',
      screen: 'Search',
      expectedResultCount: '0..1',
      actualResultCount: 0,
      startedAtMs,
    });
    logSilentEmptyState('Search', {
      collection: 'users',
      where: whereClause,
      lastSuccessfulEvent: 'username_native_empty',
    });
    searchLoadLog('FIRESTORE_SEARCH_EMPTY', { field: 'username' });
    return null;
  }
  let picked: User | null = null;
  snap.forEach((d: any) => {
    if (picked) return;
    const u = mapUserDoc(d.id, d.data() as Record<string, any>);
    if (!excludeUid || u.uid !== excludeUid) picked = u;
  });
  if (picked) {
    logFirestoreQuery({
      collection: 'users',
      where: whereClause,
      event: 'GET_RESULT',
      op: 'username_native',
      provider: 'native',
      screen: 'Search',
      expectedResultCount: '0..1',
      actualResultCount: 1,
      startedAtMs,
    });
    searchLoadLog('FIRESTORE_SEARCH_SUCCESS', { field: 'username', uid: picked.uid });
  }
  return picked;
}

export async function getUserByUsernameExact(
  username: string,
  excludeUid?: string
): Promise<User | null> {
  const candidates = usernameQueryCandidates(username);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    searchLoadLog('USERNAME_SEARCH_QUERY', { candidate });
    let hit: User | null = null;
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      hit = await getUserByUsernameNative(candidate, excludeUid);
    } else {
      hit = await getUserByUsernameWeb(candidate, excludeUid);
    }
    if (hit) {
      searchLoadLog('USERNAME_SEARCH_RESULT', { uid: hit.uid, matched: candidate });
      return hit;
    }
  }

  searchLoadLog('USERNAME_SEARCH_RESULT', { uid: null, tried: candidates.length });
  return null;
}

/**
 * Search by exact username OR by phone (normalized candidates). Returns deduped list.
 */
export async function searchUsersByUsernameOrPhone(
  input: string,
  excludeUid: string | undefined,
  region: CountryCode
): Promise<User[]> {
  const q = input.trim();
  if (!q) return [];

  const ready = await waitForRuntimeReadyForQueries();
  const runtime = getRuntimeQueryState();
  if (!ready) {
    logFirestoreQuery({
      collection: 'users',
      where: [{ field: looksLikePhoneQuery(q) ? 'phoneNumber' : 'username', op: looksLikePhoneQuery(q) ? 'in' : '==', value: q.slice(0, 32) }],
      event: 'BLOCKED_BEFORE_READY',
      op: 'searchUsersByUsernameOrPhone',
      provider: Platform.OS !== 'web' && hasNativeFirestore ? 'native' : 'web',
      screen: 'Search',
      extra: {
        firebaseReady: runtime.firebaseReady,
        firebaseProvider: runtime.firebaseProvider,
        authReady: runtime.authReady,
        authUid: runtime.authUid,
      },
    });
    return [];
  }

  const cacheKey = searchCacheKey(q, excludeUid, region);
  const cached = readCache(cacheKey);
  if (cached) return cached;

  searchLoadLog('SEARCH_CACHE_MISS');
  searchLoadLog('SEARCH_START', { q: q.slice(0, 32) });
  searchLoadLog('SEARCH_QUERY', { q: q.slice(0, 32) });
  searchLoadLog('SEARCH_QUERY_START', { q: q.slice(0, 32) });

  try {
    if (looksLikePhoneQuery(q)) {
      const candidates = phoneQueryCandidates(q, region);
      const e164 = toE164(q, region);
      searchLoadLog('PHONE_NORMALIZED', { input: q, e164, candidates: candidates.length });
      searchLoadLog('USERS_COLLECTION_FETCH_START', { candidates: candidates.length });
      const hits = await getUsersByPhoneNumbersIn(candidates, excludeUid, q);
      const rows = hits;
      if (rows.length === 0 && e164) {
        searchLoadLog('PHONE_SEARCH_MISS', { e164, candidates: candidates.length });
      }
      searchLoadLog('USERS_COLLECTION_FETCH_COMPLETE', { fetched: rows.length });
      searchLoadLog('SEARCH_QUERY_COMPLETE', { count: rows.length });
      searchLoadLog('SEARCH_RESULT_COUNT', { count: rows.length });
      searchLoadLog('SEARCH_COMPLETE', { count: rows.length });
      writeCache(cacheKey, rows);
      return rows;
    }

    const one = await getUserByUsernameExact(q, excludeUid);
    const rows = one ? [one] : [];
    searchLoadLog('SEARCH_QUERY_COMPLETE', { count: rows.length });
    searchLoadLog('SEARCH_RESULT_COUNT', { count: rows.length });
    searchLoadLog('SEARCH_COMPLETE', { count: rows.length });
    writeCache(cacheKey, rows);
    return rows;
  } catch (e) {
    searchLoadLog('SEARCH_ERROR', firestoreErrorFields(e));
    searchLoadLog('SEARCH_QUERY_ERROR', firestoreErrorFields(e));
    searchLoadLog('SEARCH_FIRESTORE_ERROR', { op: 'searchUsersByUsernameOrPhone', ...firestoreErrorFields(e) });
    throw e;
  }
}

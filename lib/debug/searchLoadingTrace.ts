/**
 * Search / recommended-users pipeline logs (Play Store safe).
 * Uses console.error so logs survive app/_layout.tsx release console silencing.
 *
 * Filter logcat: adb logcat *:E | findstr /i "SEARCH_ CONTACT_ RECOMMENDED_ LOADING_"
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';

import { prodDebug } from '@/lib/debug/prodDebug';

export type SearchLoadTag =
  | 'SEARCH_SCREEN_OPEN'
  | 'SEARCH_SCREEN_MOUNT'
  | 'SEARCH_INITIALIZATION_START'
  | 'SEARCH_INITIALIZATION_SUCCESS'
  | 'SEARCH_INITIALIZATION_FAILED'
  | 'SEARCH_LOADING_TRUE'
  | 'SEARCH_LOADING_FALSE'
  | 'SEARCH_LOADING_START'
  | 'SEARCH_LOADING_END'
  | 'LOADING_START'
  | 'LOADING_END'
  | 'SEARCH_LOADING_TIMEOUT'
  | 'SEARCH_TIMEOUT_10S'
  | 'SEARCH_TIMEOUT'
  | 'SEARCH_RETRY'
  | 'SEARCH_NETWORK_FAIL'
  | 'SEARCH_START'
  | 'SEARCH_QUERY'
  | 'SEARCH_COMPLETE'
  | 'SEARCH_ERROR'
  | 'SEARCH_CANCEL_PREVIOUS'
  | 'SEARCH_CACHE_HIT'
  | 'SEARCH_CACHE_MISS'
  | 'CONTACTS_LOAD_START'
  | 'CONTACTS_LOAD_COMPLETE'
  | 'CONTACTS_LOAD_ERROR'
  | 'CONTACT_SYNC_START'
  | 'CONTACT_SYNC_COMPLETE'
  | 'CONTACT_SYNC_FAILED'
  | 'CONTACT_SYNC_COUNT'
  | 'CONTACT_BATCH_QUERY'
  | 'CONTACT_PERMISSION_STATUS'
  | 'CONTACT_RECOMMENDATION_RESULT'
  | 'RECOMMENDED_USERS_START'
  | 'RECOMMENDED_USERS_SUCCESS'
  | 'RECOMMENDED_USERS_EMPTY'
  | 'RECOMMENDED_USERS_FAILED'
  | 'RECOMMENDED_USERS_COMPLETE'
  | 'RECOMMENDED_USERS_ERROR'
  | 'SEARCH_QUERY_START'
  | 'SEARCH_QUERY_COMPLETE'
  | 'SEARCH_QUERY_ERROR'
  | 'USERS_COLLECTION_FETCH_START'
  | 'USERS_COLLECTION_FETCH_COMPLETE'
  | 'CONTACT_MATCH_START'
  | 'CONTACT_MATCH_COMPLETE'
  | 'CONTACT_NORMALIZED'
  | 'USER_PHONE_NORMALIZED'
  | 'PHONE_NORMALIZED'
  | 'PHONE_SEARCH_MATCH'
  | 'PHONE_SEARCH_MISS'
  | 'USERNAME_SEARCH_QUERY'
  | 'USERNAME_SEARCH_RESULT'
  | 'SEARCH_RESULT_COUNT'
  | 'RECOMMENDED_COUNT'
  | 'SEARCH_RERENDER_COUNT'
  | 'SEARCH_ACTIVE_LISTENERS'
  | 'SEARCH_QUERY_COUNT'
  | 'SEARCH_FIRESTORE_REQUEST'
  | 'SEARCH_FIRESTORE_RESPONSE'
  | 'SEARCH_FIRESTORE_ERROR'
  | 'FIRESTORE_SEARCH_START'
  | 'FIRESTORE_SEARCH_SUCCESS'
  | 'FIRESTORE_SEARCH_EMPTY'
  | 'FIRESTORE_SEARCH_FAILED'
  | 'ANDROID_DEVICE_INFO'
  | 'ANDROID_VERSION'
  | 'SEARCH_DEVICE_CONTEXT';

let searchQueryCount = 0;
let searchActiveListeners = 0;
let searchRerenderCount = 0;
let lastRerenderLogAt = 0;
let deviceContextLogged = false;

/** Maps legacy tag aliases to canonical emission. */
const TAG_ALIASES: Partial<Record<SearchLoadTag, SearchLoadTag>> = {
  SEARCH_LOADING_START: 'LOADING_START',
  SEARCH_LOADING_END: 'LOADING_END',
  SEARCH_LOADING_TRUE: 'LOADING_START',
  SEARCH_LOADING_FALSE: 'LOADING_END',
  CONTACTS_LOAD_ERROR: 'CONTACT_SYNC_FAILED',
  RECOMMENDED_USERS_ERROR: 'RECOMMENDED_USERS_FAILED',
  FIRESTORE_SEARCH_FAILED: 'SEARCH_FIRESTORE_ERROR',
};

export function firestoreErrorFields(err: unknown): Record<string, unknown> {
  const e = err as { code?: string; message?: string };
  return {
    code: e?.code ?? null,
    message: e instanceof Error ? e.message : String(err),
  };
}

/** Routine per-batch / per-render telemetry — omitted in release to cut noise. */
const VERBOSE_TAGS = new Set<SearchLoadTag>([
  'CONTACT_BATCH_QUERY',
  'SEARCH_FIRESTORE_REQUEST',
  'SEARCH_FIRESTORE_RESPONSE',
  'FIRESTORE_SEARCH_EMPTY',
  'FIRESTORE_SEARCH_SUCCESS',
  'FIRESTORE_SEARCH_START',
  'SEARCH_RERENDER_COUNT',
  'SEARCH_QUERY_COUNT',
  'SEARCH_ACTIVE_LISTENERS',
  'CONTACT_NORMALIZED',
  'PHONE_NORMALIZED',
]);

export function searchLoadLog(
  tag: SearchLoadTag,
  extra?: Record<string, unknown>,
): void {
  const canonical = TAG_ALIASES[tag] ?? tag;
  if (!__DEV__ && VERBOSE_TAGS.has(canonical)) return;
  prodDebug(canonical, { tag, ...extra });
}

export function searchLoadBumpQueryCount(): number {
  searchQueryCount += 1;
  searchLoadLog('SEARCH_QUERY_COUNT', { count: searchQueryCount });
  return searchQueryCount;
}

export function searchLoadSetActiveListeners(count: number): void {
  searchActiveListeners = count;
  searchLoadLog('SEARCH_ACTIVE_LISTENERS', { count: searchActiveListeners });
}

export function searchLoadBumpRerender(extra?: Record<string, unknown>): void {
  if (!__DEV__) return;
  searchRerenderCount += 1;
  const now = Date.now();
  if (searchRerenderCount > 1 && now - lastRerenderLogAt < 2000) return;
  lastRerenderLogAt = now;
  searchLoadLog('SEARCH_RERENDER_COUNT', { count: searchRerenderCount, ...extra });
}

/** Log once per app session when search UI opens. */
export function searchLogDeviceContext(): void {
  if (deviceContextLogged) return;
  deviceContextLogged = true;
  const apiLevel =
    Platform.OS === 'android' && typeof Platform.Version === 'number'
      ? Platform.Version
      : Platform.Version;
  searchLoadLog('ANDROID_VERSION', { apiLevel, os: Platform.OS });
  searchLoadLog('ANDROID_DEVICE_INFO', {
    brand: Device.brand ?? null,
    manufacturer: Device.manufacturer ?? null,
    modelName: Device.modelName ?? null,
    osVersion: Device.osVersion ?? null,
  });
  searchLoadLog('SEARCH_DEVICE_CONTEXT', {
    platform: Platform.OS,
    apiLevel,
    isDevice: Device.isDevice,
    __DEV__,
  });
}

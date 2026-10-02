import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Contacts from 'expo-contacts';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { buildPhoneNameIndex, type PhoneNameMap } from '@/lib/contacts/contactPhoneIndex';
import { syncContactCacheToNative } from '@/lib/contacts/syncContactCacheToNative';
import { prodDebug, prodDebugError } from '@/lib/debug/prodDebug';
import { getDeviceRegionCode } from '@/lib/phoneNormalize';

/** Bump when lookup-key algorithm changes (invalidates stale persisted maps). */
const STORAGE_KEY = 'contactsPhoneNameIndex:v2';
const LEGACY_STORAGE_KEY = 'contactsPhoneNameIndex:v1';
const LOAD_TIMEOUT_MS = 25_000;

export type ContactsPermission = 'pending' | 'granted' | 'denied';

interface ContactsStore {
  /** True once a lookup map is available (persisted or fresh scan). */
  ready: boolean;
  /** Alias for `ready` — contacts cache is safe for O(1) lookup. */
  contactsReady: boolean;
  loading: boolean;
  permission: ContactsPermission;
  phoneToName: PhoneNameMap;
  revision: number;
  hydrateFromStorage: () => Promise<void>;
  preloadContacts: () => Promise<void>;
  refreshContacts: () => Promise<void>;
  /** Foreground path: hydrate from disk; full device scan only when stale. */
  refreshContactsIfStale: (minIntervalMs?: number) => Promise<void>;
  clearContacts: () => void;
}

let inflightPreload: Promise<void> | null = null;
let lastDeviceContactRefreshAt = 0;
/** Avoid blocking foreground on a full address-book scan every resume. */
const DEVICE_CONTACT_REFRESH_MIN_MS = 30 * 60 * 1000;

async function loadPersistedIndex(): Promise<PhoneNameMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PhoneNameMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function persistIndex(map: PhoneNameMap): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
}

function applyIndex(
  set: (partial: Partial<ContactsStore> | ((s: ContactsStore) => Partial<ContactsStore>)) => void,
  get: () => ContactsStore,
  map: PhoneNameMap,
  permission: ContactsPermission
): void {
  const count = Object.keys(map).length;
  set((s) => ({
    phoneToName: map,
    ready: true,
    contactsReady: true,
    loading: false,
    permission,
    revision: s.revision + 1,
  }));
  syncContactCacheToNative(map);
  prodDebug('CONTACTS_CACHE_READY', { count, permission });
}

async function readDeviceContacts(): Promise<{
  permission: ContactsPermission;
  map: PhoneNameMap;
}> {
  if (Platform.OS === 'web') {
    return { permission: 'denied', map: {} };
  }

  let granted = (await Contacts.getPermissionsAsync()).granted;
  prodDebug('CONTACT_PERMISSION_STATUS', { phase: 'getPermissionsAsync', granted });
  if (!granted) {
    granted = (await Contacts.requestPermissionsAsync()).granted;
    prodDebug('CONTACT_PERMISSION_STATUS', { phase: 'requestPermissionsAsync', granted });
  }

  if (!granted) {
    prodDebug('CONTACTS_LOAD_COMPLETE', { permission: 'denied', rows: 0, keys: 0 });
    return { permission: 'denied', map: {} };
  }

  const region = getDeviceRegionCode();
  const { data } = await Contacts.getContactsAsync({
    fields: [
      Contacts.Fields.PhoneNumbers,
      Contacts.Fields.Name,
      Contacts.Fields.FirstName,
      Contacts.Fields.LastName,
    ],
  });
  const map = buildPhoneNameIndex(data, region);
  prodDebug('CONTACTS_LOAD_COMPLETE', {
    permission: 'granted',
    source: 'device_read',
    rows: data.length,
    keys: Object.keys(map).length,
    region,
  });

  return {
    permission: 'granted',
    map,
  };
}

export const useContactsStore = create<ContactsStore>((set, get) => ({
  ready: false,
  contactsReady: false,
  loading: false,
  permission: 'pending',
  phoneToName: {},
  revision: 0,

  hydrateFromStorage: async () => {
    if (get().ready && Object.keys(get().phoneToName).length > 0) return;
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    const cached = await loadPersistedIndex();
    prodDebug('CONTACTS_CACHE_HYDRATE', { keys: Object.keys(cached).length });
    if (Object.keys(cached).length === 0) return;
    applyIndex(set, get, cached, get().permission === 'pending' ? 'granted' : get().permission);
  },

  preloadContacts: async () => {
    if (inflightPreload) return inflightPreload;

    inflightPreload = (async () => {
      if (Platform.OS === 'web') {
        set({ ready: true, contactsReady: true, loading: false, permission: 'denied' });
        return;
      }

      set({ loading: true });

      await get().hydrateFromStorage();

      const existingKeys = Object.keys(get().phoneToName).length;
      const cacheFresh =
        existingKeys > 0 &&
        Date.now() - lastDeviceContactRefreshAt < DEVICE_CONTACT_REFRESH_MIN_MS;
      if (cacheFresh) {
        set({ loading: false, ready: true, contactsReady: true });
        prodDebug('CONTACTS_PRELOAD_SKIPPED', { reason: 'disk_cache_fresh', keys: existingKeys });
        return;
      }

      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      try {
        timeoutId = setTimeout(() => {
          if (get().loading) {
            set({ loading: false, ready: true, contactsReady: true });
          }
        }, LOAD_TIMEOUT_MS);

        lastDeviceContactRefreshAt = Date.now();
        const { permission, map } = await readDeviceContacts();
        if (Object.keys(map).length > 0) {
          await persistIndex(map);
          applyIndex(set, get, map, permission);
        } else if (Object.keys(get().phoneToName).length > 0) {
          set({
            permission,
            loading: false,
            ready: true,
            contactsReady: true,
            revision: get().revision + 1,
          });
        } else {
          set({
            permission,
            loading: false,
            ready: true,
            contactsReady: true,
            revision: get().revision + 1,
          });
        }
      } catch (e) {
        prodDebugError('CONTACTS_LOAD_ERROR', e, { phase: 'preloadContacts' });
        if (__DEV__) console.warn('[contactsStore] preload failed', e);
        set({ loading: false, ready: true, contactsReady: true });
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        inflightPreload = null;
      }
    })();

    return inflightPreload;
  },

  refreshContacts: async () => {
    inflightPreload = null;
    lastDeviceContactRefreshAt = Date.now();
    set({ loading: true });
    await get().preloadContacts();
  },

  refreshContactsIfStale: async (minIntervalMs = DEVICE_CONTACT_REFRESH_MIN_MS) => {
    const now = Date.now();
    if (now - lastDeviceContactRefreshAt < minIntervalMs) {
      await get().hydrateFromStorage();
      return;
    }
    lastDeviceContactRefreshAt = now;
    await get().refreshContacts();
  },

  clearContacts: () => {
    inflightPreload = null;
    lastDeviceContactRefreshAt = 0;
    set({
      ready: false,
      contactsReady: false,
      loading: false,
      permission: 'pending',
      phoneToName: {},
      revision: get().revision + 1,
    });
    void AsyncStorage.multiRemove([STORAGE_KEY, LEGACY_STORAGE_KEY]);
    syncContactCacheToNative({});
  },
}));

/** Fast path for notification handlers — persisted map only (never blocks on device contact scan). */
export async function ensureContactsHydratedForNotifications(): Promise<void> {
  const state = useContactsStore.getState();
  if (state.contactsReady && Object.keys(state.phoneToName).length > 0) return;
  await state.hydrateFromStorage();
}

export function selectContactsReady(state: ContactsStore): boolean {
  return state.contactsReady;
}

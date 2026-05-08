import * as Contacts from 'expo-contacts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import {
  contactLineFallbackCandidates,
  contactLineToE164,
  digitsOnly,
  getDeviceRegionCode,
  phoneQueryCandidates,
  samePhoneNumber,
} from '@/lib/phoneNormalize';
import { getUsersByPhoneNumbersIn } from '@/lib/services/userSearchService';
import type { User } from '@/lib/types/chat';
import type { CountryCode } from 'libphonenumber-js';

type Permission = 'pending' | 'granted' | 'denied';

/** Cap unique Firestore `in` keys to keep queries bounded on huge address books. */
const MAX_FIRESTORE_PHONE_KEYS = 600;
const SYNC_TIMEOUT_MS = 15000;

function sortByName(list: User[]): User[] {
  return [...list].sort((a, b) => {
    const an = `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.username || '';
    const bn = `${b.firstName || ''} ${b.lastName || ''}`.trim() || b.username || '';
    return an.localeCompare(bn, undefined, { sensitivity: 'base' });
  });
}

type ContactRow = { phoneNumbers?: { number?: string }[] };

/** One representative raw string per logical number (E.164 when parseable). */
function dedupeContactPhoneRaws(rows: ContactRow[], region: CountryCode): string[] {
  const byLogical = new Map<string, string>();
  for (const row of rows) {
    for (const pn of row.phoneNumbers ?? []) {
      const raw = pn.number?.trim();
      if (!raw) continue;
      const e164 = contactLineToE164(raw, region);
      const digits = digitsOnly(raw);
      if (!e164 && digits.length < 7) continue;
      const key = e164 ?? digits;
      if (!byLogical.has(key)) byLogical.set(key, raw);
    }
  }
  return [...byLogical.values()];
}

/** Build bounded set of `phoneNumber` values to query (E.164 first, then fallbacks). */
function buildFirestorePhoneKeys(
  dedupedRaws: string[],
  region: CountryCode,
  currentPhone: string | null | undefined
): string[] {
  const out = new Set<string>();

  for (const raw of dedupedRaws) {
    const e164 = contactLineToE164(raw, region);
    if (e164 && out.size < MAX_FIRESTORE_PHONE_KEYS) out.add(e164);
  }
  for (const raw of dedupedRaws) {
    if (out.size >= MAX_FIRESTORE_PHONE_KEYS) break;
    for (const c of contactLineFallbackCandidates(raw, region)) {
      if (out.size >= MAX_FIRESTORE_PHONE_KEYS) break;
      out.add(c);
    }
  }

  if (currentPhone) {
    for (const x of phoneQueryCandidates(currentPhone, region)) out.delete(x);
    const selfE164 = contactLineToE164(currentPhone, region);
    if (selfE164) out.delete(selfE164);
  }

  return [...out];
}

/**
 * App users whose stored phone matches a number from the device address book.
 * Auto-requests contacts permission on first sync (no manual trigger).
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

  const sync = useCallback(async () => {
    if (Platform.OS === 'web') {
      setPermission('denied');
      setUsers([]);
      setContactRows(0);
      setPhoneLines(0);
      setLoading(false);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    setLoading(true);
    try {
      // Never let this hook stay indefinitely in "loading" on slow devices/networks.
      timeoutId = setTimeout(() => {
        setLoading(false);
      }, SYNC_TIMEOUT_MS);

      let granted = (await Contacts.getPermissionsAsync()).granted;
      if (!granted) {
        granted = (await Contacts.requestPermissionsAsync()).granted;
      }
      if (!granted) {
        setPermission('denied');
        setUsers([]);
        setContactRows(0);
        setPhoneLines(0);
        return;
      }

      setPermission('granted');
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
      });
      setContactRows(data.length);

      const dedupedRaws = dedupeContactPhoneRaws(data, region);
      setPhoneLines(dedupedRaws.length);

      if (dedupedRaws.length === 0) {
        setUsers([]);
        return;
      }

      const keys = buildFirestorePhoneKeys(dedupedRaws, region, currentPhone ?? undefined);
      if (keys.length === 0) {
        setUsers([]);
        return;
      }

      const fetched = await getUsersByPhoneNumbersIn(keys, currentUid);
      const matched = fetched.filter((u) =>
        dedupedRaws.some((raw) => samePhoneNumber(u.phoneNumber, raw, region))
      );
      const byUid = new Map<string, User>();
      for (const u of matched) {
        if (u.uid !== currentUid) byUid.set(u.uid, u);
      }
      setUsers(sortByName([...byUid.values()]));
    } catch {
      setUsers([]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setLoading(false);
    }
  }, [currentPhone, currentUid, region]);

  useEffect(() => {
    sync();
  }, [sync]);

  return {
    region,
    permission,
    loading,
    users,
    contactRows,
    phoneLines,
  };
}

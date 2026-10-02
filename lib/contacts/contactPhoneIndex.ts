import * as Contacts from 'expo-contacts';
import type { CountryCode } from 'libphonenumber-js';

import {
  buildPhoneLookupKeys,
  toE164,
} from '@/lib/contacts/phoneNormalization';
import { getDeviceRegionCode } from '@/lib/phoneNormalize';
import { logContactIndexBuilt } from '@/lib/perf/productionTelemetry';
import { coerceDisplayString, sanitizeProfileName } from '@/lib/unicodeText';

export type PhoneNameMap = Record<string, string>;

export type ContactLookupEntry = {
  contactName: string;
  contactId: string;
  e164: string | null;
};

/** Display label from an Expo contact row (never throws). */
export function getContactRowDisplayName(contact: Contacts.Contact): string | null {
  const nameField = contact.name?.trim();
  if (nameField) {
    const cleaned = sanitizeProfileName(nameField);
    if (cleaned) return cleaned;
  }
  const first = sanitizeProfileName(coerceDisplayString(contact.firstName));
  const last = sanitizeProfileName(coerceDisplayString(contact.lastName));
  const combined = last ? `${first} ${last}`.trim() : first;
  if (combined) return combined;
  const company = sanitizeProfileName(coerceDisplayString(contact.company));
  if (company) return company;
  return null;
}

function addKeysForNumber(
  map: PhoneNameMap,
  rawNumber: string,
  contactName: string,
  region: CountryCode
): void {
  const keys = buildPhoneLookupKeys(rawNumber, region);
  for (const key of keys) {
    if (!map[key]) map[key] = contactName;
  }
}

/**
 * Build phone-key → local contact name map from device address book.
 * Every normalized variant points at the same display name.
 */
export function buildPhoneNameIndex(
  rows: Contacts.Contact[],
  region: CountryCode = getDeviceRegionCode()
): PhoneNameMap {
  const map: PhoneNameMap = {};

  for (const contact of rows) {
    const name = getContactRowDisplayName(contact);
    if (!name) continue;

    for (const pn of contact.phoneNumbers ?? []) {
      const raw = pn.number?.trim();
      if (!raw) continue;
      addKeysForNumber(map, raw, name, region);
    }
  }

  if (__DEV__) {
    logContactIndexBuilt(rows.length, Object.keys(map).length, region);
  }

  return map;
}

/** Optional structured index (e164 primary) — used for diagnostics. */
export function buildContactLookupIndex(
  rows: Contacts.Contact[],
  region: CountryCode = getDeviceRegionCode()
): Map<string, ContactLookupEntry> {
  const byE164 = new Map<string, ContactLookupEntry>();

  for (const contact of rows) {
    const name = getContactRowDisplayName(contact);
    if (!name) continue;
    const contactId = contact.id ?? `row-${byE164.size}`;

    for (const pn of contact.phoneNumbers ?? []) {
      const raw = pn.number?.trim();
      if (!raw) continue;
      const e164 = toE164(raw, region);
      if (!e164) continue;
      if (!byE164.has(e164)) {
        byE164.set(e164, { contactName: name, contactId, e164 });
      }
    }
  }

  return byE164;
}

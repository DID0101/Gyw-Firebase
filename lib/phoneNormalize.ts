import * as Localization from 'expo-localization';
import parsePhoneNumberFromString from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';

import {
  buildPhoneLookupKeys,
  toE164 as toE164Strict,
  phonesMatch as phonesMatchStrict,
} from '@/lib/contacts/phoneNormalization';

const FALLBACK_REGION: CountryCode = 'US';

export function getDeviceRegionCode(): CountryCode {
  const code = Localization.getLocales()?.[0]?.regionCode;
  if (code && /^[A-Z]{2}$/i.test(code)) return code.toUpperCase() as CountryCode;
  return FALLBACK_REGION;
}

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** Heuristic: treat as phone search when enough digits or leading +. */
export function looksLikePhoneQuery(input: string): boolean {
  const t = input.trim();
  if (!t) return false;
  const d = digitsOnly(t);
  if (t.startsWith('+') && d.length >= 8) return true;
  return d.length >= 7;
}

/**
 * Unique strings to try against Firestore `phoneNumber` (exact match / `in`).
 * Keeps variants for formatting differences in stored profiles.
 */
/** Canonical E.164 for storage and primary Firestore lookup. */
export function normalizePhoneNumber(
  phone: string | null | undefined,
  region: CountryCode = getDeviceRegionCode()
): string | null {
  return toE164Strict(phone, region);
}

/** All stored/query variants for one input (+905…, 905…, 0555…, 555…), E.164 first. */
export function phoneQueryCandidates(input: string, region: CountryCode): string[] {
  const keys = buildPhoneLookupKeys(input, region);
  const e164 = toE164Strict(input, region);
  if (!e164) return keys;
  const rest = keys.filter((k) => k !== e164);
  return [e164, ...rest];
}

/** Prefer a single E.164 per contact line for compact batched queries. */
export function contactLineToE164(raw: string | undefined, region: CountryCode): string | null {
  return toE164Strict(raw, region);
}

/** Fallback query strings when parsing to E.164 fails (e.g. malformed entry). */
export function contactLineFallbackCandidates(raw: string | undefined, region: CountryCode): string[] {
  if (!raw?.trim()) return [];
  return buildPhoneLookupKeys(raw.trim(), region).slice(0, 8);
}

/** Same logical number (E.164 when possible, else digit comparison). */
export function samePhoneNumber(
  a: string | undefined,
  b: string | undefined,
  region: CountryCode
): boolean {
  return phonesMatchStrict(a, b, region);
}

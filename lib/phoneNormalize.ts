import * as Localization from 'expo-localization';
import parsePhoneNumberFromString from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';

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
export function phoneQueryCandidates(input: string, region: CountryCode): string[] {
  const set = new Set<string>();
  const t = input.trim();
  if (!t) return [];
  set.add(t);
  const noSpaces = t.replace(/\s/g, '');
  set.add(noSpaces);
  const p = parsePhoneNumberFromString(t, region);
  if (p?.isValid()) {
    set.add(p.number);
    if (p.number.startsWith('+')) set.add(p.number.slice(1));
    const nat = p.formatNational().replace(/\s/g, '');
    if (nat) set.add(nat);
  }
  return [...set].filter((x) => x.length > 0);
}

/** Prefer a single E.164 per contact line for compact batched queries. */
export function contactLineToE164(raw: string | undefined, region: CountryCode): string | null {
  if (!raw?.trim()) return null;
  const p = parsePhoneNumberFromString(raw.trim(), region);
  return p?.isValid() ? p.number : null;
}

/** Fallback query strings when parsing to E.164 fails (e.g. malformed entry). */
export function contactLineFallbackCandidates(raw: string | undefined, region: CountryCode): string[] {
  if (!raw?.trim()) return [];
  return phoneQueryCandidates(raw.trim(), region).slice(0, 4);
}

/** Same logical number (E.164 when possible, else digit comparison). */
export function samePhoneNumber(
  a: string | undefined,
  b: string | undefined,
  region: CountryCode
): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  const pa = parsePhoneNumberFromString(a.trim(), region);
  const pb = parsePhoneNumberFromString(b.trim(), region);
  if (pa?.isValid() && pb?.isValid()) return pa.number === pb.number;
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  return da.length >= 7 && da === db;
}

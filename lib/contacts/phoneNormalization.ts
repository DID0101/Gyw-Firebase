import parsePhoneNumberFromString, {
  type CountryCode,
  type PhoneNumber,
} from 'libphonenumber-js';

import { getDeviceRegionCode } from '@/lib/phoneNormalize';
import { coerceDisplayString } from '@/lib/unicodeText';

/** Strip spaces, dashes, brackets — keep leading + and digits. */
export function stripPhoneFormatting(phone: string): string {
  return coerceDisplayString(phone).trim().replace(/[\s\-\.\(\)\[\]]/g, '');
}

export function digitsOnly(phone: string): string {
  return coerceDisplayString(phone).replace(/\D/g, '');
}

/**
 * Parse to libphonenumber PhoneNumber when possible.
 * Tries default country, then a small set of common regions for expats.
 */
function parsePhone(
  raw: string,
  defaultCountry: CountryCode = getDeviceRegionCode()
): PhoneNumber | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const attempts: CountryCode[] = [defaultCountry];
  if (defaultCountry !== 'TR') attempts.push('TR');
  if (defaultCountry !== 'US') attempts.push('US');
  if (defaultCountry !== 'GB') attempts.push('GB');

  const seen = new Set<CountryCode>();
  for (const region of attempts) {
    if (seen.has(region)) continue;
    seen.add(region);
    try {
      const p = parsePhoneNumberFromString(trimmed, region);
      if (p?.isValid()) return p;
    } catch {
      /* ignore */
    }
  }

  try {
    const p = parsePhoneNumberFromString(trimmed);
    if (p?.isValid()) return p;
  } catch {
    /* ignore */
  }

  return null;
}

/** Canonical E.164 (+905551112233) or null. */
export function toE164(
  phone: string | null | undefined,
  defaultCountry: CountryCode = getDeviceRegionCode()
): string | null {
  const raw = coerceDisplayString(phone).trim();
  if (!raw) return null;
  const parsed = parsePhone(raw, defaultCountry);
  return parsed?.isValid() ? parsed.number : null;
}

/** @deprecated Use toE164 — kept for existing imports. */
export function normalizePhoneStrict(
  phone: string | null | undefined,
  defaultCountry: CountryCode = getDeviceRegionCode()
): string | null {
  return toE164(phone, defaultCountry);
}

/**
 * All keys that should resolve to the same logical number in the contact cache.
 * Example TR: +905551112233, 905551112233, 05551112233, 5551112233
 */
export function buildPhoneLookupKeys(
  phone: string | null | undefined,
  defaultCountry: CountryCode = getDeviceRegionCode()
): string[] {
  const raw = coerceDisplayString(phone).trim();
  if (!raw) return [];

  const keys = new Set<string>();
  const add = (k: string | null | undefined) => {
    const v = k?.trim();
    if (!v || v.length < 7) return;
    keys.add(v);
  };

  add(raw);
  add(stripPhoneFormatting(raw));

  const parsed = parsePhone(raw, defaultCountry);
  if (parsed?.isValid()) {
    const e164 = parsed.number;
    add(e164);
    if (e164.startsWith('+')) add(e164.slice(1));

    const nationalFormatted = parsed.formatNational();
    add(nationalFormatted);
    add(digitsOnly(nationalFormatted));

    const nsn = parsed.nationalNumber;
    if (nsn) {
      add(nsn);
      add(`0${nsn}`);
    }

    const cc = parsed.country;
    if (cc === 'TR' && nsn) {
      add(`90${nsn}`);
      add(`+90${nsn}`);
      add(`0${nsn}`);
    }
  }

  const digits = digitsOnly(raw);
  if (digits.length >= 7) {
    add(digits);
    if (digits.startsWith('00') && digits.length > 10) {
      add(`+${digits.slice(2)}`);
      add(digits.slice(2));
    }
    if (digits.startsWith('90') && digits.length >= 12) {
      const local = digits.slice(2);
      add(local);
      add(`0${local}`);
      add(`+${digits}`);
    }
    if (digits.startsWith('0') && digits.length === 11 && defaultCountry === 'TR') {
      const withoutZero = digits.slice(1);
      add(withoutZero);
      add(`90${withoutZero}`);
      add(`+90${withoutZero}`);
    }
  }

  return [...keys];
}

export function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
  defaultCountry: CountryCode = getDeviceRegionCode()
): boolean {
  const e164a = toE164(a, defaultCountry);
  const e164b = toE164(b, defaultCountry);
  if (e164a && e164b) return e164a === e164b;
  const da = digitsOnly(coerceDisplayString(a));
  const db = digitsOnly(coerceDisplayString(b));
  return da.length >= 7 && da === db;
}

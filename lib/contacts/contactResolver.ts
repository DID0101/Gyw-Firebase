import parsePhoneNumberFromString, { type CountryCode } from 'libphonenumber-js';

import {
  buildPhoneLookupKeys,
  toE164,
} from '@/lib/contacts/phoneNormalization';
import { useContactsStore } from '@/store/contactsStore';
import { getDeviceRegionCode } from '@/lib/phoneNormalize';
import { buildDisplayName, coerceDisplayString, sanitizeProfileName } from '@/lib/unicodeText';

export type ResolveUserInput = {
  phoneNumber?: string | null;
  firstName?: unknown;
  lastName?: unknown;
  username?: unknown;
  displayName?: unknown;
  participantName?: unknown;
  name?: unknown;
};

export type ResolveSource = 'contact' | 'profile' | 'phone' | 'fallback';

export type ResolveDisplayNameOptions = {
  fallback?: string;
  region?: CountryCode;
  logContext?: string;
  /** When true, skip stale participantData snapshot if phone lookup is possible. */
  preferLiveProfile?: boolean;
};

const UNKNOWN_FALLBACK = 'Unknown';

/** @deprecated Use toE164 from phoneNormalization */
export function normalizePhoneNumber(
  phone: string | null | undefined,
  region: CountryCode = getDeviceRegionCode()
): string | null {
  return toE164(phone, region);
}

/** Synchronous O(1) lookup — uses prebuilt cache only. */
export function resolveContactNameByPhone(
  phone: string | null | undefined,
  region: CountryCode = getDeviceRegionCode(),
  _logContext?: string
): string | null {
  const raw = coerceDisplayString(phone).trim();
  if (!raw) return null;

  const { phoneToName, ready, permission } = useContactsStore.getState();
  const cacheSize = phoneToName ? Object.keys(phoneToName).length : 0;
  const cacheUsable = cacheSize > 0;

  if (!cacheUsable && !ready) {
    return null;
  }

  if (permission === 'denied' && !cacheUsable) {
    return null;
  }

  const queryKeys = buildPhoneLookupKeys(raw, region);
  for (const key of queryKeys) {
    const hit = phoneToName[key];
    if (hit) return hit;
  }

  return null;
}

/** Profile name only — never reads address book. */
export function resolveProfileDisplayName(
  user: ResolveUserInput,
  fallback: string = UNKNOWN_FALLBACK
): string {
  const profile = buildDisplayName(
    user.firstName,
    user.lastName,
    user.username,
    '',
    {
      displayName: user.displayName,
      participantName: user.participantName,
    }
  );
  if (profile) return profile;

  const legacy = sanitizeProfileName(coerceDisplayString(user.name));
  if (legacy) return legacy;

  return fallback;
}

function formatPhoneForDisplay(phone: string, region: CountryCode): string {
  const e164 = toE164(phone, region);
  if (!e164) return phone.trim();
  try {
    const p = parsePhoneNumberFromString(e164);
    if (p?.isValid()) return p.formatInternational();
  } catch {
    /* ignore */
  }
  return e164;
}

/**
 * WhatsApp-style display name:
 * 1. local phone contact name
 * 2. live profile (first/last/displayName/username) — not stale participant snapshot when phone present
 * 3. formatted phone
 * 4. fallback
 */
export function resolveDisplayName(
  user: ResolveUserInput,
  options: ResolveDisplayNameOptions = {}
): string {
  const region = options.region ?? getDeviceRegionCode();
  const fallback = options.fallback ?? UNKNOWN_FALLBACK;
  const hasPhone = !!coerceDisplayString(user.phoneNumber).trim();

  const profileInput: ResolveUserInput = hasPhone && options.preferLiveProfile !== false
    ? {
        ...user,
        participantName: undefined,
      }
    : user;

  const local = resolveContactNameByPhone(user.phoneNumber, region, options.logContext);
  if (local) return local;

  const profile = resolveProfileDisplayName(profileInput, '');
  if (profile) return profile;

  const phoneRaw = coerceDisplayString(user.phoneNumber).trim();
  if (phoneRaw) return formatPhoneForDisplay(phoneRaw, region);

  return fallback;
}

/** Resolve incoming call / FCM payload (profile name + optional phone). */
export function resolveCallerDisplayName(input: {
  callerName?: string | null;
  callerPhone?: string | null;
  firstName?: unknown;
  lastName?: unknown;
  username?: unknown;
  displayName?: unknown;
}): string {
  const profileFallback =
    coerceDisplayString(input.callerName).trim() ||
    resolveProfileDisplayName(
      {
        firstName: input.firstName,
        lastName: input.lastName,
        username: input.username,
        displayName: input.displayName,
      },
      'Incoming call'
    );

  return resolveDisplayName(
    {
      phoneNumber: input.callerPhone,
      firstName: input.firstName,
      lastName: input.lastName,
      username: input.username,
      displayName: input.displayName,
    },
    { fallback: profileFallback, logContext: 'incoming_call', preferLiveProfile: true }
  );
}

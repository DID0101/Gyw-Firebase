/**
 * Unicode-safe text utilities for profile names, usernames, search, and UI.
 *
 * Goals:
 *  - Never throw on null/undefined/non-string input
 *  - Preserve international letters and emojis in *display* fields
 *  - Strip control / invisible exploit characters
 *  - Grapheme-safe avatar initials (emoji-aware)
 *  - Locale-aware search matching (Turkish İ, etc.)
 */

const CONTROL_AND_BIDI =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFEFF\u200B-\u200F\u202A-\u202E\u2060-\u2064]/g;

const MAX_PROFILE_NAME = 64;
const MAX_USERNAME_BASE = 32;
const MAX_BIO = 280;
const MAX_GROUP_NAME = 100;

/** Coerce any value to a safe display string (never throws). */
export function coerceDisplayString(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

/** NFC normalize + strip dangerous invisible/control chars. */
export function normalizeUnicodeInput(input: string, maxLength?: number): string {
  let s = coerceDisplayString(input);
  try {
    s = s.normalize('NFC');
  } catch {
    /* ignore */
  }
  s = s.replace(CONTROL_AND_BIDI, '');
  if (typeof maxLength === 'number' && maxLength > 0 && s.length > maxLength) {
    s = Array.from(s).slice(0, maxLength).join('');
  }
  return s;
}

/** Display names: letters, numbers, spaces, punctuation, emojis — no control chars. */
export function sanitizeProfileName(input: string): string {
  return normalizeUnicodeInput(input, MAX_PROFILE_NAME).trim();
}

/** Bio / group description — allow newlines, still strip controls. */
export function sanitizeBioText(input: string): string {
  return normalizeUnicodeInput(input, MAX_BIO);
}

export function sanitizeGroupName(input: string): string {
  return normalizeUnicodeInput(input, MAX_GROUP_NAME).trim();
}

/**
 * Username handle (before _NN suffix): letters, numbers, underscore.
 * Emojis and spaces are stripped — display names carry emojis instead.
 */
export function sanitizeUsernameBase(input: string): string {
  let s = normalizeUnicodeInput(input, MAX_USERNAME_BASE);
  s = stripEmojis(s);
  s = s.replace(/\s+/g, '');
  try {
    s = s.replace(/[^\p{L}\p{N}_]/gu, '');
  } catch {
    // Fallback when Unicode properties unavailable
    s = s.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF]/g, '');
  }
  return s.toLocaleLowerCase('en-US');
}

function stripEmojis(s: string): string {
  try {
    return s.replace(/\p{Extended_Pictographic}/gu, '');
  } catch {
    return s;
  }
}

/** Null-safe trim with Unicode normalization. */
export function safeTrim(value: unknown): string {
  return normalizeUnicodeInput(coerceDisplayString(value)).trim();
}

/** Grapheme-safe substring (emoji-aware); never throws. */
export function safeSubstring(value: unknown, maxGraphemes: number): string {
  const s = coerceDisplayString(value);
  if (!s || maxGraphemes <= 0) return '';
  try {
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      return [...seg.segment(s)]
        .slice(0, maxGraphemes)
        .map((part) => part.segment)
        .join('');
    }
  } catch {
    /* fall through */
  }
  return Array.from(s).slice(0, maxGraphemes).join('');
}

export type BuildDisplayNameExtras = {
  /** Firebase Auth / profile displayName (often has emojis). */
  displayName?: unknown;
  /** chats/{id}.participantData[uid].name snapshot. */
  participantName?: unknown;
};

/** Build a user-visible display name without undefined/null gaps. */
export function buildDisplayName(
  firstName?: unknown,
  lastName?: unknown,
  username?: unknown,
  fallback = 'Unknown',
  extras?: BuildDisplayNameExtras
): string {
  const first = sanitizeProfileName(coerceDisplayString(firstName));
  const last = sanitizeProfileName(coerceDisplayString(lastName));
  const combined = last ? `${first} ${last}`.trim() : first;
  if (combined) return combined;

  const profileDisplay = sanitizeProfileName(coerceDisplayString(extras?.displayName));
  if (profileDisplay) return profileDisplay;

  const participant = sanitizeProfileName(coerceDisplayString(extras?.participantName));
  if (participant) return participant;

  const uname = coerceDisplayString(username).trim();
  if (uname) return uname;
  return fallback;
}

/** First grapheme for avatar placeholder — emoji-safe. */
export function getAvatarInitial(name: unknown): string {
  const safe = coerceDisplayString(name).trim();
  if (!safe) return '?';
  try {
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const first = [...seg.segment(safe)][0]?.segment;
      if (first) return first.toLocaleUpperCase();
    }
  } catch {
    /* fall through */
  }
  const chars = Array.from(safe);
  const initial = chars[0];
  return initial ? initial.toLocaleUpperCase() : '?';
}

/** Alias — chat/profile UI entry point. */
export const safeDisplayName = buildDisplayName;

/** Alias — avatar placeholder entry point. */
export const safeInitials = getAvatarInitial;

/** Locale-aware case folding for search (Turkish İ, German ß, etc.). */
export function normalizeForSearch(input: string): string {
  const s = normalizeUnicodeInput(input);
  try {
    return s.toLocaleLowerCase(undefined);
  } catch {
    return s.toLowerCase();
  }
}

/** Safe substring search — never throws on null haystack. */
export function textIncludes(haystack: unknown, needle: string): boolean {
  const n = normalizeForSearch(needle.trim());
  if (!n) return true;
  const h = normalizeForSearch(coerceDisplayString(haystack));
  return h.includes(n);
}

export function buildFinalUsername(base: string, number: string): string {
  const b = sanitizeUsernameBase(base);
  const num = coerceDisplayString(number).replace(/\D/g, '').slice(0, 2);
  return num ? `${b}_${num}` : b;
}

export type ProfileValidationResult =
  | { ok: true; firstName: string; lastName: string; usernameBase: string; usernameNumber: string; finalUsername: string; displayName: string }
  | { ok: false; error: string };

/** Validate signup / complete-profile fields — never throws. */
export function validateSignupProfileFields(
  firstName: string,
  lastName: string,
  usernameBase: string,
  usernameNumber: string
): ProfileValidationResult {
  const first = sanitizeProfileName(firstName);
  if (!first) {
    if (__DEV__) console.log('PROFILE_INVALID_INPUT', { field: 'firstName' });
    return { ok: false, error: 'firstName_required' };
  }
  const last = sanitizeProfileName(lastName);
  const base = sanitizeUsernameBase(usernameBase);
  if (!base) {
    if (__DEV__) console.log('PROFILE_INVALID_INPUT', { field: 'username' });
    return { ok: false, error: 'username_required' };
  }
  const num = coerceDisplayString(usernameNumber).replace(/\D/g, '');
  if (num.length !== 2) {
    if (__DEV__) console.log('PROFILE_INVALID_INPUT', { field: 'usernameNumber' });
    return { ok: false, error: 'username_number_invalid' };
  }
  const finalUsername = buildFinalUsername(base, num);
  if (__DEV__ && finalUsername !== `${usernameBase}_${usernameNumber}`.toLowerCase()) {
    console.log('USERNAME_SANITIZED', { from: `${usernameBase}_${usernameNumber}`, to: finalUsername });
  }
  return {
    ok: true,
    firstName: first,
    lastName: last,
    usernameBase: base,
    usernameNumber: num,
    finalUsername,
    displayName: buildDisplayName(first, last),
  };
}

/** Fields ready for Firestore user doc write. */
export function prepareUserDocFields(fields: {
  uid: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
  username: string;
  photoURL?: string;
  bio?: string;
}): Record<string, string | boolean> {
  const now = new Date().toISOString();
  return {
    uid: fields.uid,
    phoneNumber: coerceDisplayString(fields.phoneNumber),
    firstName: sanitizeProfileName(fields.firstName),
    lastName: sanitizeProfileName(fields.lastName),
    username: coerceDisplayString(fields.username).trim(),
    photoURL: coerceDisplayString(fields.photoURL),
    bio: sanitizeBioText(fields.bio ?? ''),
    createdAt: now,
    lastSeen: now,
    isOnline: false,
  };
}

/** Safe profile update patch (no username mutation). */
export function prepareProfileUpdateFields(fields: {
  firstName: string;
  lastName?: string;
  bio?: string;
}): { firstName: string; lastName: string; bio: string; displayName: string } {
  const first = sanitizeProfileName(fields.firstName);
  const last = sanitizeProfileName(fields.lastName ?? '');
  const bio = sanitizeBioText(fields.bio ?? '');
  return {
    firstName: first,
    lastName: last,
    bio,
    displayName: buildDisplayName(first, last),
  };
}

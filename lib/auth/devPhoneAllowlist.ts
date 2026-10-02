/**
 * Dev-only phone bypass when Play Integrity / reCAPTCHA fail on physical devices.
 * Sync allowlist with Firestore `system/devPhoneAuth` (see devPhoneLoginHandler.ts).
 *
 * Format: EXPO_PUBLIC_DEV_PHONE_CODES="+905369936898:123456,+15555550100:654321"
 */
import { Platform } from 'react-native';

export type DevPhoneEntry = { phone: string; code: string };

function parseAllowlist(raw: string | undefined): DevPhoneEntry[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.lastIndexOf(':');
      if (idx <= 0) return null;
      const phone = part.slice(0, idx).trim();
      const code = part.slice(idx + 1).trim();
      if (!phone.startsWith('+') || code.length < 4) return null;
      return { phone, code };
    })
    .filter((e): e is DevPhoneEntry => e != null);
}

const BUILTIN_DEV_PHONES: DevPhoneEntry[] = [
  { phone: '+905369936898', code: '123456' },
];

let cached: DevPhoneEntry[] | null = null;

export function getDevPhoneAllowlist(): DevPhoneEntry[] {
  if (cached) return cached;
  const fromEnv = parseAllowlist(process.env.EXPO_PUBLIC_DEV_PHONE_CODES);
  const merged = new Map<string, string>();
  for (const e of BUILTIN_DEV_PHONES) merged.set(e.phone, e.code);
  for (const e of fromEnv) merged.set(e.phone, e.code);
  cached = [...merged.entries()].map(([phone, code]) => ({ phone, code }));
  return cached;
}

export function getDevPhoneCode(phoneNumber: string): string | null {
  if (!__DEV__ || Platform.OS === 'web') return null;
  const normalized = phoneNumber.replace(/[^\d+]/g, '');
  const entry = getDevPhoneAllowlist().find((e) => e.phone === normalized);
  return entry?.code ?? null;
}

export function isDevPhoneAllowlisted(phoneNumber: string): boolean {
  return getDevPhoneCode(phoneNumber) != null;
}

export function devPhoneLoginEnabled(): boolean {
  return __DEV__ && Platform.OS !== 'web' && getDevPhoneAllowlist().length > 0;
}

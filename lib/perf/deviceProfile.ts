import { Platform } from 'react-native';

/** Android API level when on Android; 0 otherwise. */
export function androidApiLevel(): number {
  if (Platform.OS !== 'android') return 0;
  const v = Platform.Version;
  return typeof v === 'number' ? v : parseInt(String(v), 10) || 0;
}

/** Android 7–9 (API 24–28): tightest lists & more deferral on old phones. */
export function isLegacyAndroid(): boolean {
  const api = androidApiLevel();
  return api >= 24 && api <= 28;
}

/** Android 10 and below (API ≤29) — Samsung/Redmi tier: cap list work. */
export function isLowTierAndroid(): boolean {
  const api = androidApiLevel();
  return api > 0 && api <= 29;
}

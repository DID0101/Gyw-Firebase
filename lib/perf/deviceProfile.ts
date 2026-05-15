import { Platform } from 'react-native';

/** Android API level when on Android; 0 otherwise. */
export function androidApiLevel(): number {
  if (Platform.OS !== 'android') return 0;
  const v = Platform.Version;
  return typeof v === 'number' ? v : parseInt(String(v), 10) || 0;
}

/** Android 8.x–9.x (API 26–28): tighter lists & more deferral. */
export function isLegacyAndroid(): boolean {
  const api = androidApiLevel();
  return api >= 26 && api <= 28;
}

/** Android 10 and below (API ≤29) — Samsung/Redmi tier: cap list work. */
export function isLowTierAndroid(): boolean {
  const api = androidApiLevel();
  return api > 0 && api <= 29;
}

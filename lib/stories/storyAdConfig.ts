import { Platform } from 'react-native';

/** Google sample native ad unit — used when no production unit is configured. */
const ANDROID_TEST_NATIVE_AD_UNIT = 'ca-app-pub-3940256099942544/2247696110';

export function isStoryAdsSupported(): boolean {
  return Platform.OS === 'android';
}

export function getStoryNativeAdUnitId(): string {
  const fromEnv = process.env.EXPO_PUBLIC_ADMOB_ANDROID_STORY_NATIVE_AD_UNIT_ID?.trim();
  if (fromEnv) return fromEnv;
  return ANDROID_TEST_NATIVE_AD_UNIT;
}

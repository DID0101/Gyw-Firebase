import { Platform } from 'react-native';

/** Best-effort RAM relief when the app backgrounds (expo-image in-memory cache). */
export function releaseImageMemoryCache(): void {
  if (Platform.OS !== 'android') return;
  try {
    const { Image } = require('expo-image') as {
      clearMemoryCache?: () => Promise<boolean>;
    };
    if (typeof Image.clearMemoryCache === 'function') {
      void Image.clearMemoryCache();
    }
  } catch {
    /* non-fatal */
  }
}

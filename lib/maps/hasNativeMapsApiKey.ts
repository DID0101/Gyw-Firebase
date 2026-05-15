import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** True when Expo config includes a Google Maps key (Android / iOS embedded maps). */
export function hasNativeMapsApiKey(): boolean {
  if (Platform.OS === 'web') return false;
  const expo = Constants.expoConfig;
  if (Platform.OS === 'android') {
    const k = (expo?.android?.config as { googleMaps?: { apiKey?: string } } | undefined)?.googleMaps?.apiKey;
    return typeof k === 'string' && k.trim().length > 10;
  }
  const k = (expo?.ios?.config as { googleMapsApiKey?: string } | undefined)?.googleMapsApiKey;
  return typeof k === 'string' && k.trim().length > 10;
}

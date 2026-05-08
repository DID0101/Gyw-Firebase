import AsyncStorage from '@react-native-async-storage/async-storage';

/** Persists last signed-in uid for routing when native auth isn't hydrated yet. */
const KEY = 'gyw:authLastKnownUid';

export async function persistLastKnownAuthUid(uid: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, uid);
  } catch {
    /* ignore */
  }
}

export async function clearLastKnownAuthUid(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export async function getLastKnownAuthUidAsync(): Promise<string | null> {
  try {
    return (await AsyncStorage.getItem(KEY)) ?? null;
  } catch {
    return null;
  }
}

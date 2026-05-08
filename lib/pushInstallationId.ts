import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'gyw_push_installation_id_v1';

/** Stable per-install ID for multi-device FCM rows under userTokens/{uid}/devices/{id}. */
export async function getPushInstallationId(): Promise<string> {
  let id = await AsyncStorage.getItem(KEY);
  if (!id) {
    id = `pi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
    await AsyncStorage.setItem(KEY, id);
  }
  return id;
}

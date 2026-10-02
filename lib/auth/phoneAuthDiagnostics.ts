import { NativeModules, Platform } from 'react-native';

type AuthActivitySnapshot = {
  currentActivity: string;
  taskId: number;
  resumedActivity: string;
  playServicesStatus: number;
};

export async function logAuthActivitySnapshot(phase: string): Promise<void> {
  if (!__DEV__ || Platform.OS !== 'android') return;
  try {
    const mod = NativeModules.PhoneAuthDiagnostics as
      | { getAuthActivitySnapshot: () => Promise<AuthActivitySnapshot> }
      | undefined;
    if (!mod?.getAuthActivitySnapshot) {
      console.log(`[AUTH_PHONE] ${phase}`, JSON.stringify({ snapshot: 'module_unavailable' }));
      return;
    }
    const snap = await mod.getAuthActivitySnapshot();
    console.log(`[AUTH_PHONE] ${phase}`, JSON.stringify(snap));
  } catch (e) {
    console.log(`[AUTH_PHONE] ${phase}`, JSON.stringify({ snapshotError: String(e) }));
  }
}

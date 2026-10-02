import { Alert, NativeModules, Platform } from 'react-native';

type PhoneAuthDiagnosticsNative = {
  preparePhoneAuth: () => Promise<{ deviceSecure: boolean; cryptoCleared: boolean }>;
  clearPhoneAuthCrypto: () => Promise<boolean>;
};

function getNative(): PhoneAuthDiagnosticsNative | null {
  if (Platform.OS !== 'android') return null;
  return NativeModules.PhoneAuthDiagnostics as PhoneAuthDiagnosticsNative | undefined ?? null;
}

/** Warm WebView, clear stale Firebase crypto prefs, warn if no screen lock. */
export async function prepareAndroidPhoneAuth(): Promise<{
  deviceSecure: boolean;
  cryptoCleared: boolean;
} | null> {
  const mod = getNative();
  if (!mod?.preparePhoneAuth) return null;

  const result = await mod.preparePhoneAuth();
  if (!result.deviceSecure && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(
      '[AUTH_PHONE] device has no screen lock — Play Integrity may fail on some OEM phones (TECNO/Oppo). Set a PIN/pattern.'
    );
  }
  return result;
}

export async function clearAndroidPhoneAuthCrypto(): Promise<boolean> {
  const mod = getNative();
  if (!mod?.clearPhoneAuthCrypto) return false;
  return mod.clearPhoneAuthCrypto();
}

export function warnIfNoScreenLock(deviceSecure: boolean): void {
  if (deviceSecure) return;
  Alert.alert(
    'Screen lock required',
    'Phone sign-in needs a device PIN, pattern, or password for security verification. Please set one in Settings, then try again.',
    [{ text: 'OK' }]
  );
}

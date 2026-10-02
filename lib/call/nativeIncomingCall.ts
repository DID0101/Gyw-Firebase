import { NativeModules, Platform } from 'react-native';

type IncomingCallModuleNative = {
  isNativeIncomingCallVisible?: () => Promise<boolean>;
};

/** True when Android IncomingCallActivity is in the foreground. */
export async function isNativeIncomingCallVisible(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const mod = NativeModules.IncomingCallModule as IncomingCallModuleNative | undefined;
  if (!mod?.isNativeIncomingCallVisible) return false;
  try {
    return (await mod.isNativeIncomingCallVisible()) === true;
  } catch {
    return false;
  }
}

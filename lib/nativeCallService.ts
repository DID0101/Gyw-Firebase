import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

const { GywCallModule } = NativeModules as {
  GywCallModule?: {
    startIncomingCall(callId: string, callerName: string, callType: string): void;
    stopIncomingCall(): void;
    getPendingCall(): Promise<{
      callId: string;
      callerName: string;
      callType: string;
      callerId: string;
      receivedAt: string;
    } | null>;
    clearPendingCall(): void;
    readFcmLog(): Promise<string>;
    appendDebugTrace(line: string): void;
    readDebugTrace(): Promise<string>;
    getRegisteredFcmServices(): Promise<string>;
    getBatteryOptimizationStatus(): Promise<string>;
    requestBatteryOptimizationExemption(): void;
    requestFullScreenIntentPermission(): void;
  };
};

export type NativePendingCall = {
  callId: string;
  callerName: string;
  callType: string;
  callerId: string;
  receivedAt: string;
};

export function nativeStartIncomingCall(callId: string, callerName: string, callType: string): void {
  if (Platform.OS !== 'android') return;
  if (!GywCallModule) {
    console.error(
      '[GywCallModule] ⚠️ NOT AVAILABLE — native module missing.',
      'This means GywCallService will NOT start.',
      'You must rebuild the dev client after adding the native module.',
      { callId }
    );
    return;
  }
  try {
    console.error('[GywCallModule] startIncomingCall', { callId, callerName, callType });
    GywCallModule.startIncomingCall(callId, callerName ?? 'Unknown', callType ?? 'audio');
  } catch (e) {
    console.error('[GywCallModule] startIncomingCall THREW', e);
  }
}

export function nativeStopIncomingCall(): void {
  if (Platform.OS !== 'android') return;
  if (!GywCallModule) {
    return;
  }
  try {
    GywCallModule.stopIncomingCall();
  } catch (e) {
    console.error('[GywCallModule] stopIncomingCall THREW', e);
  }
}

export async function nativeGetPendingCall(): Promise<NativePendingCall | null> {
  if (Platform.OS !== 'android' || !GywCallModule?.getPendingCall) return null;
  try {
    return await GywCallModule.getPendingCall();
  } catch (e) {
    console.error('[GywCallModule] getPendingCall failed', e);
    return null;
  }
}

export function nativeClearPendingCall(): void {
  if (Platform.OS !== 'android' || !GywCallModule?.clearPendingCall) return;
  try {
    GywCallModule.clearPendingCall();
  } catch {
    /* ignore */
  }
}

export async function nativeReadFcmLog(): Promise<string> {
  if (Platform.OS !== 'android' || !GywCallModule?.readFcmLog) {
    return 'MODULE_NOT_AVAILABLE';
  }
  try {
    return await GywCallModule.readFcmLog();
  } catch (e) {
    return 'ERROR: ' + String(e);
  }
}

export function nativeAppendDebugTrace(line: string): void {
  if (Platform.OS !== 'android' || !GywCallModule?.appendDebugTrace) return;
  try {
    GywCallModule.appendDebugTrace(line);
  } catch {
    /* ignore */
  }
}

export async function nativeReadDebugTrace(): Promise<string> {
  if (Platform.OS !== 'android' || !GywCallModule?.readDebugTrace) {
    return 'MODULE_NOT_AVAILABLE';
  }
  try {
    return await GywCallModule.readDebugTrace();
  } catch (e) {
    return 'ERROR: ' + String(e);
  }
}

/** Services registered for `com.google.firebase.MESSAGING_EVENT` in this package (logcat + debug UI). */
export async function nativeGetRegisteredFcmServices(): Promise<string> {
  if (Platform.OS !== 'android' || !GywCallModule?.getRegisteredFcmServices) {
    return 'MODULE_NOT_AVAILABLE';
  }
  try {
    return await GywCallModule.getRegisteredFcmServices();
  } catch (e) {
    return 'ERROR: ' + String(e);
  }
}

/** JSON string: battery whitelist, restrictBackgroundStatus, OEM note (TECNO autostart not API-readable). */
export async function nativeGetBatteryOptimizationStatus(): Promise<string> {
  if (Platform.OS !== 'android' || !GywCallModule?.getBatteryOptimizationStatus) {
    return 'MODULE_NOT_AVAILABLE';
  }
  try {
    return await GywCallModule.getBatteryOptimizationStatus();
  } catch (e) {
    return 'ERROR: ' + String(e);
  }
}

/**
 * Opens the system "Disable battery optimization" dialog for this app.
 * Must be called while an Activity is visible (e.g. from a useEffect on the root layout).
 * Critical for TECNO HiOS / Xiaomi MIUI / aggressive OEMs — without the whitelist,
 * GywFcmService may not be woken when the phone is sleeping.
 */
export function nativeRequestBatteryOptimizationExemption(): void {
  if (Platform.OS !== 'android' || !GywCallModule?.requestBatteryOptimizationExemption) return;
  try {
    GywCallModule.requestBatteryOptimizationExemption();
  } catch (e) {
    console.error('[GywCallModule] requestBatteryOptimizationExemption THREW', e);
  }
}

/**
 * On Android 14+, USE_FULL_SCREEN_INTENT is no longer auto-granted.
 * Without it the incoming call notification never shows on the lock screen.
 * Opens the Special App Access settings page for the user to grant it.
 */
export function nativeRequestFullScreenIntentPermission(): void {
  if (Platform.OS !== 'android' || !GywCallModule?.requestFullScreenIntentPermission) return;
  try {
    GywCallModule.requestFullScreenIntentPermission();
  } catch (e) {
    console.error('[GywCallModule] requestFullScreenIntentPermission THREW', e);
  }
}

if (Platform.OS === 'android' && NativeModules.GywCallModule) {
  const emitter = new NativeEventEmitter(NativeModules.GywCallModule);
  emitter.addListener('GywNativeFcmReceived', (payload: string) => {
    console.error('⏰ NATIVE SERVICE RESPONSE at', Date.now(), {
      event: 'GywNativeFcmReceived',
      payload,
    });
    console.error('🚨🚨🚨 NATIVE FCM CONFIRMED IN JS', payload);
  });
}

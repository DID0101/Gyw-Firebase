import { Platform, Vibration } from 'react-native';

/** ~WhatsApp/Telegram feel: pulse, pause, pulse (repeats on Android). */
const ANDROID_PATTERN_MS = [0, 520, 380, 520];

let iosPulseTimer: ReturnType<typeof setInterval> | null = null;

export function startIncomingCallVibration(): void {
  if (Platform.OS === 'web') return;
  stopIncomingCallVibration();
  try {
    if (Platform.OS === 'android') {
      Vibration.vibrate(ANDROID_PATTERN_MS, true);
    } else {
      const pulse = () => {
        try {
          Vibration.vibrate(400);
        } catch {
          /* ignore */
        }
      };
      pulse();
      iosPulseTimer = setInterval(pulse, 1550);
    }
  } catch {
    /* ignore */
  }
}

export function stopIncomingCallVibration(): void {
  try {
    if (Platform.OS === 'android') {
      Vibration.cancel();
    }
    if (iosPulseTimer) {
      clearInterval(iosPulseTimer);
      iosPulseTimer = null;
    }
  } catch {
    /* ignore */
  }
}

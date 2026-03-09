/**
 * Continuous ringtone loop for incoming calls.
 * Plays until stop() is called (Accept/Decline) or component unmounts.
 * The FCM notification sound plays once; this provides continuous ringing.
 */
import { Audio } from 'expo-av';
import { useCallback, useEffect, useRef } from 'react';
import { Platform, Vibration } from 'react-native';

const RINGTONE_SOURCE = require('@/assets/sounds/ringtone.wav');

// Vibration pattern: wait 0ms, vibrate 500ms, pause 500ms, repeat
const VIBRATION_PATTERN = [0, 500, 500];

export function useIncomingCallRinger(isActive: boolean) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const vibrationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(async () => {
    if (vibrationIntervalRef.current) {
      clearInterval(vibrationIntervalRef.current);
      vibrationIntervalRef.current = null;
    }
    Vibration.cancel();
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch (_) {}
      soundRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isActive) {
      stop();
      return;
    }

    let mounted = true;

    const startRinging = async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });

        const { sound } = await Audio.Sound.createAsync(RINGTONE_SOURCE, {
          isLooping: true,
          volume: 1.0,
        });

        if (!mounted) {
          await sound.unloadAsync();
          return;
        }

        soundRef.current = sound;
        await sound.playAsync();

        // Start vibration pattern (Android)
        if (Platform.OS === 'android') {
          vibrationIntervalRef.current = setInterval(() => {
            Vibration.vibrate(VIBRATION_PATTERN);
          }, 2000); // Repeat pattern every 2s
        }
      } catch (err) {
        if (__DEV__) console.warn('[IncomingCallRinger] Failed to play:', err);
      }
    };

    startRinging();

    return () => {
      mounted = false;
      stop();
    };
  }, [isActive, stop]);

  return { stop };
}

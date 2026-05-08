import { useTheme } from '@/contexts/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { Audio, AVPlaybackStatus, InterruptionModeAndroid } from 'expo-av';
import * as Haptics from 'expo-haptics';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

interface AudioMessageProps {
  messageId: string;
  uri: string;
  duration: number; // in seconds
  isSender: boolean;
}

// Singleton: only one audio plays at a time
let globalStopCallback: (() => Promise<void>) | null = null;

/** Stops all audio playback. Call when leaving chat. */
export async function stopAllAudioPlayback(): Promise<void> {
  if (globalStopCallback) {
    await globalStopCallback();
    globalStopCallback = null;
  }
}

const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const VALID_URI_PREFIXES = ['http://', 'https://', 'file://', 'content://'];

const AudioMessage: React.FC<AudioMessageProps> = ({ messageId, uri, duration, isSender }) => {
  const { isDark } = useTheme();
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const isMountedRef = useRef(true);
  const tapLockRef = useRef(false);

  const safeDuration = Number.isFinite(duration) && duration >= 0 ? duration : 0;
  const formattedDuration = formatDuration(safeDuration);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
      if (globalStopCallback === stopCurrent) {
        globalStopCallback = null;
      }
    };
  }, []);

  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    }).catch(() => {});
  }, []);

  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded || !isMountedRef.current) return;
    if (status.positionMillis != null && status.durationMillis != null && status.durationMillis > 0) {
      setProgress(status.positionMillis / status.durationMillis);
    }
    if (status.didJustFinish) {
      setIsPlaying(false);
      setProgress(0);
      soundRef.current?.setPositionAsync(0).catch(() => {});
      soundRef.current?.stopAsync().catch(() => {});
    }
  }, []);

  const stopCurrent = useCallback(async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.pauseAsync();
      } catch (_) {}
      if (isMountedRef.current) setIsPlaying(false);
    }
  }, []);

  const stopOtherPlayback = useCallback(async () => {
    if (globalStopCallback && globalStopCallback !== stopCurrent) {
      await globalStopCallback();
    }
  }, []);

  const togglePlayback = useCallback(async () => {
    if (tapLockRef.current) return;
    tapLockRef.current = true;
    setTimeout(() => { tapLockRef.current = false; }, 300);

    const validUri = uri?.trim();
    if (!validUri || !VALID_URI_PREFIXES.some(p => validUri.startsWith(p))) {
      if (__DEV__) console.error('AudioMessage: Invalid URI');
      setError(true);
      return;
    }

    try {
      if (isPlaying) {
        await soundRef.current?.pauseAsync();
        setIsPlaying(false);
        return;
      }

      await stopOtherPlayback();

      if (!soundRef.current) {
        setLoading(true);
        setError(false);
        try {
          const { sound } = await Audio.Sound.createAsync(
            { uri: validUri },
            { shouldPlay: true },
            onPlaybackStatusUpdate
          );
          if (!isMountedRef.current) {
            sound.unloadAsync().catch(() => {});
            return;
          }
          soundRef.current = sound;
          globalStopCallback = stopCurrent;
          setIsPlaying(true);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } catch (err) {
          if (__DEV__) console.error('AudioMessage: Load error', err);
          if (isMountedRef.current) {
            setError(true);
            setIsPlaying(false);
          }
        } finally {
          if (isMountedRef.current) setLoading(false);
        }
      } else {
        await soundRef.current.playAsync();
        globalStopCallback = stopCurrent;
        setIsPlaying(true);
      }
    } catch (err) {
      if (__DEV__) console.error('AudioMessage: Playback error', err);
      if (isMountedRef.current) {
        setError(true);
        setIsPlaying(false);
      }
    }
  }, [uri, isPlaying, onPlaybackStatusUpdate, stopOtherPlayback, stopCurrent]);

  const handleSeek = useCallback(async (ratio: number) => {
    const clamped = Math.max(0, Math.min(1, ratio));
    if (soundRef.current && safeDuration > 0) {
      await soundRef.current.setPositionAsync(clamped * safeDuration * 1000);
      setProgress(clamped);
    }
  }, [safeDuration]);

  const progressBarPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      if (barWidth > 0) handleSeek(evt.nativeEvent.locationX / barWidth);
    },
    onPanResponderMove: (evt) => {
      if (barWidth > 0) handleSeek(evt.nativeEvent.locationX / barWidth);
    },
  }), [barWidth, handleSeek]);

  const progressColor = isSender ? '#FFFFFF' : (isDark ? '#FF5722' : '#FF5722');
  const unplayedColor = isSender ? 'rgba(255,255,255,0.3)' : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)');
  const durationColor = isSender ? 'rgba(255,255,255,0.9)' : (isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)');
  // High-contrast: solid white for sender (on teal bubble), solid teal for receiver
  const buttonBg = isSender ? '#FFFFFF' : '#FF5722';
  const iconColor = isSender ? '#FF5722' : '#FFFFFF';

  const frameStyle = [
    styles.frame,
    isSender ? styles.frameSender : (isDark ? styles.frameReceiverDark : styles.frameReceiver),
  ];

  if (error) {
    return (
      <View style={frameStyle}>
        <View style={styles.layout}>
          <View style={[styles.playButton, { backgroundColor: buttonBg, opacity: 0.6 }]}>
            <Ionicons name="alert-circle" size={20} color={iconColor} />
          </View>
          <Text style={[styles.durationText, { color: durationColor, marginLeft: 12 }]}>
            Unable to play
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={frameStyle}>
      <View style={styles.layout}>
        <Pressable
          onPress={togglePlayback}
          disabled={loading}
          style={({ pressed }) => [
            styles.playButton,
            { backgroundColor: buttonBg, borderColor: isSender ? 'rgba(51,126,132,0.25)' : 'rgba(0,0,0,0.08)' },
            pressed && styles.playButtonPressed,
            loading && styles.playButtonDisabled,
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={iconColor} />
          ) : (
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={22}
              color={iconColor}
              style={!isPlaying ? { marginLeft: 3 } : undefined}
            />
          )}
        </Pressable>

        <View
          style={styles.progressContainer}
          onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width)}
          {...progressBarPan.panHandlers}
        >
          <View style={[styles.progressBarTrack, { backgroundColor: unplayedColor }]}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${progress * 100}%`, backgroundColor: progressColor },
              ]}
            />
            <View
              style={[
                styles.scrubber,
                { left: `${progress * 100}%`, backgroundColor: progressColor },
              ]}
              pointerEvents="none"
            />
          </View>
        </View>

        <Text style={[styles.durationText, { color: durationColor }]}>
          {formattedDuration}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  frameSender: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  frameReceiver: {
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  frameReceiverDark: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  layout: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    minHeight: 44,
  },
  playButton: {
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    flexShrink: 0,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  playButtonPressed: {
    opacity: 0.85,
  },
  playButtonDisabled: {
    opacity: 0.8,
  },
  progressContainer: {
    flex: 1,
    minWidth: 60,
    marginHorizontal: 10,
    justifyContent: 'center',
    height: 24,
  },
  progressBarTrack: {
    height: 4,
    width: '100%',
    borderRadius: 2,
    position: 'relative',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  scrubber: {
    width: 10,
    height: 10,
    borderRadius: 5,
    position: 'absolute',
    top: -3,
    marginLeft: -5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  durationText: {
    fontSize: 12,
    minWidth: 36,
    fontWeight: '500',
  },
});

export default memo(AudioMessage, (prev, next) =>
  prev.messageId === next.messageId &&
  prev.uri === next.uri &&
  prev.duration === next.duration &&
  prev.isSender === next.isSender
);

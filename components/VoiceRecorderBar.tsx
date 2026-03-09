/**
 * WhatsApp-grade voice recorder: Hold-to-Talk, Slide-to-Cancel, Lock-to-Record
 */
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Pressable, Text, View } from 'react-native';
import clsx from 'clsx';

const SLIDE_CANCEL_THRESHOLD = 120;
const LOCK_THRESHOLD = 80;
const MIN_RECORD_DURATION = 0.5;

interface VoiceRecorderBarProps {
  isDark: boolean;
  onStartRecording: () => Promise<boolean>;
  onStopRecording: (cancel: boolean) => Promise<void>;
  getRecordingDuration: () => number;
  isRecording: boolean;
  isLocked: boolean;
  onLockChange: (locked: boolean) => void;
  /** When true, show "Hold to record" mic button instead of recording UI */
  isReady?: boolean;
}

export const VoiceRecorderBar: React.FC<VoiceRecorderBarProps> = ({
  isDark,
  onStartRecording,
  onStopRecording,
  getRecordingDuration,
  isRecording,
  isLocked,
  onLockChange,
  isReady = true,
}) => {
  const { t } = useTranslation();
  const [elapsedSec, setElapsedSec] = useState(0);
  const [dragHint, setDragHint] = useState<'none' | 'cancel' | 'lock'>('none');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const pulseOpacity = useSharedValue(0.5);

  useEffect(() => {
    if (isRecording || isLocked) {
      timerRef.current = setInterval(() => {
        setElapsedSec((s) => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsedSec(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording, isLocked]);

  useEffect(() => {
    if (isRecording) {
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 400 }),
          withTiming(0.4, { duration: 400 })
        ),
        -1,
        true
      );
    } else {
      pulseOpacity.value = withTiming(0.5);
    }
  }, [isRecording]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleCancel = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onStopRecording(true);
    setDragHint('none');
    translateX.value = withSpring(0);
    translateY.value = withSpring(0);
  }, [onStopRecording]);

  const handleLock = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onLockChange(true);
    setDragHint('none');
    translateX.value = withSpring(0);
    translateY.value = withSpring(0);
  }, [onLockChange]);

  const handleSend = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onStopRecording(false);
  }, [onStopRecording]);

  const handlePanEnd = useCallback((tx: number, ty: number) => {
    if (!isRecording) {
      handleCancel();
      return;
    }
    if (tx < -SLIDE_CANCEL_THRESHOLD) {
      handleCancel();
    } else if (ty < -LOCK_THRESHOLD) {
      handleLock();
    } else {
      const duration = getRecordingDuration();
      if (duration >= MIN_RECORD_DURATION) {
        handleSend();
      } else {
        handleCancel();
      }
    }
  }, [isRecording, getRecordingDuration, handleCancel, handleLock, handleSend]);

  const triggerStartRecording = useCallback(() => {
    onStartRecording().then((started) => {
      if (started) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }).catch(() => {});
  }, [onStartRecording]);

  const panGesture = Gesture.Pan()
    .minDistance(0)
    .onStart(() => {
      if (isRecording || isLocked) return;
      runOnJS(triggerStartRecording)();
    })
    .onUpdate((e) => {
      if (!isRecording || isLocked) return;
      translateX.value = e.translationX;
      translateY.value = e.translationY;
      if (e.translationX < -SLIDE_CANCEL_THRESHOLD) {
        runOnJS(setDragHint)('cancel');
      } else if (e.translationY < -LOCK_THRESHOLD) {
        runOnJS(setDragHint)('lock');
      } else {
        runOnJS(setDragHint)('none');
      }
    })
    .onEnd((e) => {
      if (isLocked) return;
      const tx = e.translationX;
      const ty = e.translationY;
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
      runOnJS(setDragHint)('none');
      runOnJS(handlePanEnd)(tx, ty);
    });

  const barAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: Math.min(0, translateY.value) },
    ],
  }));

  const pulseAnimatedStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  if (isReady && !isRecording) {
    return (
      <View style={{ flex: 1 }}>
        <GestureDetector gesture={panGesture}>
          <View
            className={clsx(
              'flex-row items-center justify-center flex-1 py-3 rounded-2xl mx-2',
              isDark ? 'bg-gray-800' : 'bg-gray-100'
            )}
          >
            <Feather name="mic" size={24} color={isDark ? '#9ca3af' : '#6b7280'} />
            <Text className={clsx('ml-2 text-sm', isDark ? 'text-gray-400' : 'text-gray-600')}>
              Hold to record
            </Text>
          </View>
        </GestureDetector>
      </View>
    );
  }

  if (isLocked) {
    return (
      <View
        style={{ flex: 1 }}
        className={clsx(
          'flex-row items-center justify-between px-4 py-3 rounded-2xl mx-2',
          isDark ? 'bg-gray-800' : 'bg-gray-100'
        )}
      >
        <View className="flex-row items-center gap-3">
          <View className="w-3 h-3 rounded-full bg-red-500" />
          <Text className={clsx('text-base font-medium', isDark ? 'text-white' : 'text-black')}>
            {formatTime(elapsedSec)}
          </Text>
        </View>
        <Pressable
          onPress={handleSend}
          className="bg-[#337E84] rounded-full px-6 py-2"
        >
          <View className="flex-row items-center gap-2">
            <Feather name="send" size={18} color="white" />
            <Text className="text-white font-semibold">{t('messages.send')}</Text>
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[barAnimatedStyle, { flex: 1 }]}
          className={clsx(
            'flex-row items-center px-4 py-3 rounded-2xl mx-2',
            isDark ? 'bg-gray-800' : 'bg-gray-100'
          )}
        >
          <View className="flex-row items-center flex-1 gap-3">
            <Animated.View
              style={pulseAnimatedStyle}
              className="w-3 h-3 rounded-full bg-red-500"
            />
            <Text className={clsx('text-base font-medium min-w-[40px]', isDark ? 'text-white' : 'text-black')}>
              {formatTime(elapsedSec)}
            </Text>
            {dragHint === 'cancel' && (
              <Text className={clsx('text-sm', isDark ? 'text-red-400' : 'text-red-500')}>
                ← {t('common.cancel')}
              </Text>
            )}
            {dragHint === 'lock' && (
              <View className="flex-row items-center gap-1">
                <Feather name="lock" size={14} color={isDark ? '#9ca3af' : '#6b7280'} />
                <Text className={clsx('text-sm', isDark ? 'text-gray-400' : 'text-gray-600')}>
                  Lock
                </Text>
              </View>
            )}
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

export default VoiceRecorderBar;

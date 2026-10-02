/**
 * Lightweight in-app toast — no external library needed.
 *
 * Usage:
 *   showToast('This feature requires an internet connection.');
 *   showToast('Message queued', 'info');
 *
 * Mount <ToastHost /> once in the root layout (already done in _layout.tsx).
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ToastType = 'info' | 'success' | 'warning' | 'error';

interface ToastEntry {
  id: number;
  message: string;
  type: ToastType;
  durationMs: number;
}

let nextId = 0;
const toastListeners = new Set<(entry: ToastEntry) => void>();

export function showToast(
  message: string,
  type: ToastType = 'info',
  durationMs = 2500
): void {
  const entry: ToastEntry = { id: ++nextId, message, type, durationMs };
  toastListeners.forEach((fn) => {
    try { fn(entry); } catch { /* swallow */ }
  });
}

const PALETTE: Record<ToastType, { bg: string; text: string }> = {
  info: { bg: '#1f2937', text: '#f9fafb' },
  success: { bg: '#065f46', text: '#ecfdf5' },
  warning: { bg: '#78350f', text: '#fef3c7' },
  error: { bg: '#7f1d1d', text: '#fef2f2' },
};

const SingleToast = memo(function SingleToast({
  entry,
  onDone,
}: {
  entry: ToastEntry;
  onDone: (id: number) => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    const hideTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 24, duration: 180, useNativeDriver: true }),
      ]).start(() => onDone(entry.id));
    }, entry.durationMs);

    return () => clearTimeout(hideTimer);
  }, [entry.durationMs, entry.id, onDone, opacity, translateY]);

  const palette = PALETTE[entry.type];
  return (
    <Animated.View
      style={[
        styles.toast,
        { backgroundColor: palette.bg, opacity, transform: [{ translateY }] },
      ]}
    >
      <Text style={[styles.toastText, { color: palette.text }]} numberOfLines={2}>
        {entry.message}
      </Text>
    </Animated.View>
  );
});

export const ToastHost = memo(function ToastHost() {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  useEffect(() => {
    const listener = (entry: ToastEntry) => {
      setToasts((prev) => [...prev.slice(-2), entry]);
    };
    toastListeners.add(listener);
    return () => { toastListeners.delete(listener); };
  }, []);

  const handleDone = useCallback(
    (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    []
  );

  if (toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.container, { bottom: insets.bottom + (Platform.OS === 'ios' ? 20 : 50) }]}
    >
      {toasts.map((t) => (
        <SingleToast key={t.id} entry={t} onDone={handleDone} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 24,
    right: 24,
    alignItems: 'center',
    zIndex: 999,
  },
  toast: {
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    maxWidth: 340,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  toastText: {
    fontSize: 13.5,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 18,
  },
});

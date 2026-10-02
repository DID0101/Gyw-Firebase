import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useNetworkState } from '@/lib/networkState';
import { useSyncStatus, type SyncPhase } from '@/lib/offline/syncStatus';

/**
 * Global top banner that surfaces three states:
 *
 *   1. Offline  → red "No internet connection"  (sticky)
 *   2. Slow     → amber "Slow connection"        (~3 s per transition)
 *   3. Syncing  → teal "Syncing messages..."     (auto-hides after flush)
 *      Done     → teal "Up to date"              (auto-hides after 2 s)
 *
 * Renders in the root layout so every screen gets it without changes.
 */
const HIDDEN_HEIGHT = 0;
const VISIBLE_HEIGHT = 28;
const DONE_DISPLAY_MS = 2200;

type BannerMode = 'offline' | 'slow' | 'syncing' | 'done' | 'hidden';

function deriveBannerMode(
  isOffline: boolean,
  isSlow: boolean,
  syncPhase: SyncPhase
): BannerMode {
  if (isOffline) return 'offline';
  if (syncPhase === 'syncing') return 'syncing';
  if (syncPhase === 'done') return 'done';
  if (isSlow) return 'slow';
  return 'hidden';
}

const BANNER_CONFIG: Record<Exclude<BannerMode, 'hidden'>, { color: string; label: string }> = {
  offline: { color: '#dc2626', label: 'No internet connection' },
  slow: { color: '#f59e0b', label: 'Slow connection — messages may take longer' },
  syncing: { color: '#0d9488', label: 'Syncing messages…' },
  done: { color: '#0d9488', label: 'Up to date' },
};

const OfflineBanner = () => {
  const { reachability, isSlow } = useNetworkState();
  const { phase: syncPhase } = useSyncStatus();
  const insets = useSafeAreaInsets();

  const isOffline = reachability === 'offline';

  const rawMode = deriveBannerMode(isOffline, isSlow, syncPhase);

  // "done" auto-hides after DONE_DISPLAY_MS; "slow" after 3 s.
  const [visibleMode, setVisibleMode] = useState<BannerMode>(rawMode);
  useEffect(() => {
    if (rawMode === 'hidden') {
      setVisibleMode('hidden');
      return;
    }
    setVisibleMode(rawMode);
    if (rawMode === 'done') {
      const t = setTimeout(() => setVisibleMode('hidden'), DONE_DISPLAY_MS);
      return () => clearTimeout(t);
    }
    if (rawMode === 'slow') {
      const t = setTimeout(() => setVisibleMode('hidden'), 3000);
      return () => clearTimeout(t);
    }
  }, [rawMode]);

  const show = visibleMode !== 'hidden';
  const visibleAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(visibleAnim, {
      toValue: show ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [show, visibleAnim]);

  if (!show) return null;

  const cfg = BANNER_CONFIG[visibleMode as Exclude<BannerMode, 'hidden'>];

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        {
          paddingTop: insets.top + 4,
          backgroundColor: cfg.color,
          height: visibleAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [HIDDEN_HEIGHT, VISIBLE_HEIGHT + insets.top + 4],
          }),
        },
      ]}
    >
      <View style={styles.row}>
        <Text style={styles.text} numberOfLines={1}>
          {cfg.label}
        </Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    zIndex: 99,
  },
  row: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  text: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
});

export default OfflineBanner;

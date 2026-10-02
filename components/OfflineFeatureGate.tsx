/**
 * Wraps a pressable element and disables it when the network is offline.
 *
 *   <OfflineFeatureGate feature="voiceCall">
 *     <Pressable onPress={startCall}><Text>Call</Text></Pressable>
 *   </OfflineFeatureGate>
 *
 * When offline the child is rendered at 40% opacity and taps show a toast.
 */
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  useOfflineAwareFeatures,
  type GatedFeature,
} from '@/lib/hooks/useOfflineAwareFeatures';
import { showToast } from '@/components/Toast';

interface Props {
  feature: GatedFeature;
  children: React.ReactNode;
  /** Override the default "requires internet" message. */
  offlineMessage?: string;
}

const OfflineFeatureGate = memo(function OfflineFeatureGate({
  feature,
  children,
  offlineMessage,
}: Props) {
  const { availability } = useOfflineAwareFeatures();
  const enabled = availability[feature];

  const onDisabledTap = useCallback(() => {
    showToast(
      offlineMessage ?? 'This feature requires an internet connection.',
      'warning'
    );
  }, [offlineMessage]);

  if (enabled) {
    return <>{children}</>;
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.disabled} pointerEvents="none">
        {children}
      </View>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onDisabledTap}
        accessibilityRole="button"
        accessibilityLabel="Feature unavailable offline"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  disabled: {
    opacity: 0.4,
  },
});

export default OfflineFeatureGate;

import type { ChatMessage } from '@/lib/types/chat';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import MessageStatusIndicator from './MessageStatusIndicator';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_W = Math.min(SCREEN_WIDTH * 0.62, 260);
const MAP_H = Math.round(CARD_W * 0.56);

type Props = {
  message: ChatMessage;
  isMyMessage: boolean;
  isDark: boolean;
  timeLabel: string;
  isFailed: boolean;
  liveLocationExpired: boolean;
  locationOwnsFooter: boolean;
  onOpenMaps: () => void;
  onRetry?: () => void;
};

/** WhatsApp-style location card: static preview, centered pin, title, optional address, time + ticks. */
const LocationMessageBubble = memo(function LocationMessageBubble({
  message,
  isMyMessage,
  isDark,
  timeLabel,
  isFailed,
  liveLocationExpired,
  locationOwnsFooter,
  onOpenMaps,
  onRetry,
}: Props) {
  const { t } = useTranslation();
  const previewUrl = message.previewUrl!;

  const showPinOverlay = !previewUrl.includes('markers=');

  const title = useMemo(() => {
    const raw = message.placeName?.trim();
    if (raw) return raw;
    return t('location.share');
  }, [message.placeName, t]);

  const subtitle = message.placeAddress?.trim();

  const onPressIn = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };

  const onLongPress = async () => {
    if (typeof message.latitude !== 'number' || typeof message.longitude !== 'number') return;
    const text = `${message.latitude.toFixed(6)}, ${message.longitude.toFixed(6)}`;
    await Clipboard.setStringAsync(text);
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  };

  const timeColor = isMyMessage ? 'rgba(255,255,255,0.92)' : isDark ? '#e5e7eb' : '#374151';
  const titleColor = isMyMessage ? '#ffffff' : isDark ? '#f9fafb' : '#111827';
  const subtitleColor = isMyMessage ? 'rgba(255,255,255,0.82)' : isDark ? '#9ca3af' : '#6b7280';
  const dividerColor = isMyMessage ? 'rgba(255,255,255,0.22)' : isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  return (
    <Pressable
      onPress={onOpenMaps}
      onPressIn={onPressIn}
      onLongPress={onLongPress}
      delayLongPress={420}
      android_ripple={
        Platform.OS === 'android'
          ? { color: isMyMessage ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.08)' }
          : undefined
      }
      style={({ pressed }) => [
        {
          width: CARD_W,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: isMyMessage ? 'rgba(0,0,0,0.12)' : isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.04)',
          opacity: pressed ? 0.92 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={t('location.openInMapsApp')}
    >
      <View style={{ width: CARD_W, height: MAP_H, backgroundColor: isDark ? '#374151' : '#d1d5db' }}>
        <ExpoImage
          source={{ uri: previewUrl }}
          style={{ width: CARD_W, height: MAP_H }}
          contentFit="cover"
          cachePolicy="disk"
          recyclingKey={`loc-${message.id}`}
        />
        {showPinOverlay ? (
          <View style={styles.pinWrap} pointerEvents="none">
            <View style={styles.pinCircle}>
              <Feather name="map-pin" size={26} color="#E53935" style={{ marginTop: -2 }} />
            </View>
          </View>
        ) : null}
        {message.isLive ? (
          <View style={styles.liveChip} pointerEvents="none">
            <View
              style={[
                styles.liveDot,
                { backgroundColor: liveLocationExpired ? '#9ca3af' : '#34D399' },
              ]}
            />
            <Text style={styles.liveChipText}>
              {liveLocationExpired ? t('location.liveEnded') : t('location.liveBadge')}
            </Text>
          </View>
        ) : null}
        {locationOwnsFooter ? (
          <View style={styles.mapTimeRow}>
            <Text style={[styles.mapTimeText, { color: timeColor, textShadowColor: 'rgba(0,0,0,0.45)' }]}>
              {timeLabel}
            </Text>
            {isMyMessage ? (
              isFailed && onRetry ? (
                <Pressable onPress={onRetry} hitSlop={10} accessibilityLabel={t('a11y.retrySending')}>
                  <Feather name="alert-circle" size={13} color="#fecaca" />
                </Pressable>
              ) : (
                <MessageStatusIndicator status={message.status || 'sent'} size={13} />
              )
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={[styles.footer, { borderTopColor: dividerColor }]}>
        <Text style={[styles.title, { color: titleColor }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: subtitleColor }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pinWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
    elevation: 3,
  },
  liveChip: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  liveChipText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  mapTimeRow: {
    position: 'absolute',
    right: 8,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mapTimeText: {
    fontSize: 11,
    fontWeight: '600',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  footer: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  subtitle: {
    marginTop: 3,
    fontSize: 12.5,
    lineHeight: 16,
  },
});

export default LocationMessageBubble;

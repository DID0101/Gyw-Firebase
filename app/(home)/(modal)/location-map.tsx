import { useTheme } from '@/contexts/ThemeContext';
import { subscribeLiveLocationSession } from '@/lib/location/subscribeLiveLocationSession';
import { hasNativeMapsApiKey } from '@/lib/maps/hasNativeMapsApiKey';
import { openInNativeMaps } from '@/lib/maps/openInNativeMaps';
import { Feather } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function LocationMapScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useTheme();
  const isDark = colorScheme === 'dark';
  const params = useLocalSearchParams<{
    chatId?: string;
    messageId?: string;
    lat?: string;
    lng?: string;
    isLive?: string;
    expiresAt?: string;
    placeName?: string;
  }>();

  const chatId = params.chatId ?? '';
  const messageId = params.messageId ?? '';
  const initialLat = parseFloat(params.lat ?? '0');
  const initialLng = parseFloat(params.lng ?? '0');
  const isLive = params.isLive === '1';
  const expiresAt = params.expiresAt ?? '';
  const placeName = params.placeName ?? '';

  const [coord, setCoord] = useState({ latitude: initialLat, longitude: initialLng });
  const mapRef = useRef<MapView | null>(null);
  const liveActive =
    isLive && expiresAt && !Number.isNaN(Date.parse(expiresAt)) && Date.parse(expiresAt) > Date.now();

  useEffect(() => {
    setCoord({ latitude: initialLat, longitude: initialLng });
  }, [initialLat, initialLng]);

  useEffect(() => {
    if (!liveActive || !chatId || !messageId) return;
    const unsub = subscribeLiveLocationSession(
      chatId,
      messageId,
      (lat, lng) => {
        setCoord({ latitude: lat, longitude: lng });
        mapRef.current?.animateToRegion(
          {
            latitude: lat,
            longitude: lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          450
        );
      },
      (e) => {
        if (__DEV__) console.warn('[location-map] live listener', e);
      }
    );
    return unsub;
  }, [liveActive, chatId, messageId]);

  const region = useMemo(
    () => ({
      latitude: coord.latitude,
      longitude: coord.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }),
    [coord.latitude, coord.longitude]
  );

  const openInSystemMaps = useCallback(() => {
    if (!Number.isFinite(coord.latitude) || !Number.isFinite(coord.longitude)) return;
    void openInNativeMaps({
      latitude: coord.latitude,
      longitude: coord.longitude,
      label: placeName || undefined,
    });
  }, [coord.latitude, coord.longitude, placeName]);

  const useExternalMapOnly = Platform.OS === 'web' || !hasNativeMapsApiKey();
  if (useExternalMapOnly) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: isDark ? '#111827' : '#fff' }}>
        <Stack.Screen options={{ title: t('location.title') }} />
        <View style={{ flex: 1, padding: 20, justifyContent: 'center' }}>
          <Text style={{ color: isDark ? '#e5e7eb' : '#111', marginBottom: 16, textAlign: 'center' }}>
            {placeName || t('location.title')}
          </Text>
          {Platform.OS !== 'web' ? (
            <Text
              style={{
                color: isDark ? '#9ca3af' : '#6b7280',
                marginBottom: 16,
                textAlign: 'center',
                fontSize: 13,
                lineHeight: 18,
              }}
            >
              {t('location.mapsKeyHint')}
            </Text>
          ) : null}
          <Pressable
            onPress={openInSystemMaps}
            style={{
              alignSelf: 'center',
              backgroundColor: '#FF5722',
              paddingHorizontal: 20,
              paddingVertical: 12,
              borderRadius: 12,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>{t('location.openInMapsApp')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!Number.isFinite(coord.latitude) || !Number.isFinite(coord.longitude)) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Stack.Screen options={{ title: t('location.title') }} />
        <Text style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>{t('location.invalid')}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#111827' : '#fff' }}>
      <Stack.Screen
        options={{
          title: t('location.title'),
          headerRight: () => (
            <Pressable onPress={openInSystemMaps} hitSlop={12} style={{ paddingHorizontal: 8 }}>
              <Feather name="external-link" size={22} color={isDark ? '#fff' : '#111'} />
            </Pressable>
          ),
        }}
      />
      <MapView ref={mapRef} style={{ flex: 1 }} initialRegion={region}>
        <Marker coordinate={{ latitude: coord.latitude, longitude: coord.longitude }} title={placeName || undefined} />
      </MapView>
      {(liveActive && (
        <View
          style={{
            position: 'absolute',
            top: 12 + insets.top,
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: 'rgba(16,185,129,0.95)',
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 20,
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' }} />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{t('location.liveBadge')}</Text>
        </View>
      )) ||
        null}
      {placeName ? (
        <View
          style={{
            position: 'absolute',
            bottom: 24 + insets.bottom,
            left: 16,
            right: 16,
            backgroundColor: isDark ? 'rgba(31,41,55,0.92)' : 'rgba(255,255,255,0.95)',
            padding: 12,
            borderRadius: 12,
          }}
        >
          <Text style={{ color: isDark ? '#f3f4f6' : '#111827', fontWeight: '600' }} numberOfLines={2}>
            {placeName}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

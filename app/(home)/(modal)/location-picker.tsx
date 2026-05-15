import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { formatGeocodeForLocationMessage } from '@/lib/maps/formatGeocodeForLocationMessage';
import { hasNativeMapsApiKey } from '@/lib/maps/hasNativeMapsApiKey';
import { sendLocationMessage } from '@/lib/services/chatService';
import * as Location from 'expo-location';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Platform, Pressable, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

const DEFAULT_REGION = {
  latitude: 20,
  longitude: 0,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function LocationPickerScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { colorScheme } = useTheme();
  const isDark = colorScheme === 'dark';
  const { chatId } = useLocalSearchParams<{ chatId?: string }>();
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== Location.PermissionStatus.GRANTED) {
          if (!cancelled) {
            setLoading(false);
            Alert.alert(t('common.permissionRequired'), t('location.permissionDenied'));
          }
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const { latitude, longitude } = pos.coords;
        setRegion({
          latitude,
          longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      } catch {
        if (!cancelled) {
          Alert.alert(t('common.error'), t('location.failed'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const onSend = useCallback(async () => {
    if (!user?.uid || !chatId) {
      Alert.alert(t('common.error'), t('location.failed'));
      return;
    }
    setSending(true);
    try {
      let placeName: string | undefined;
      let placeAddress: string | undefined;
      try {
        const geo = await Location.reverseGeocodeAsync({
          latitude: region.latitude,
          longitude: region.longitude,
        });
        const g = geo[0];
        if (g) {
          const fmt = formatGeocodeForLocationMessage(g);
          placeName = fmt.placeName;
          placeAddress = fmt.placeAddress;
        }
      } catch {
        /* optional */
      }
      await sendLocationMessage(
        chatId,
        user.uid,
        user.displayName || user.phoneNumber || 'User',
        user.photoURL || undefined,
        region.latitude,
        region.longitude,
        { placeName, placeAddress }
      );
      router.back();
    } catch (e) {
      if (__DEV__) console.warn('[location-picker] send', e);
      Alert.alert(t('common.error'), t('messages.failedToSend'));
    } finally {
      setSending(false);
    }
  }, [chatId, user, region.latitude, region.longitude, router, t]);

  if (Platform.OS === 'web' || !hasNativeMapsApiKey()) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Stack.Screen options={{ title: t('location.pickOnMap') }} />
        <Text style={{ color: isDark ? '#9ca3af' : '#6b7280', textAlign: 'center', marginBottom: 12 }}>
          {Platform.OS === 'web' ? t('location.webPickerUnavailable') : t('location.mapsKeyHint')}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#111827' : '#fff' }}>
      <Stack.Screen
        options={{
          title: t('location.pickOnMap'),
          headerRight: () => (
            <Pressable
              onPress={() => void onSend()}
              disabled={sending || loading || !chatId}
              style={{ paddingHorizontal: 12, opacity: sending || loading ? 0.5 : 1 }}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FF5722" />
              ) : (
                <Text style={{ color: '#FF5722', fontWeight: '700', fontSize: 16 }}>{t('messages.send')}</Text>
              )}
            </Pressable>
          ),
        }}
      />
      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#FF5722" />
        </View>
      ) : (
        <MapView style={{ flex: 1 }} region={region} onRegionChangeComplete={setRegion}>
          <Marker coordinate={{ latitude: region.latitude, longitude: region.longitude }} />
        </MapView>
      )}
      <View
        style={{
          position: 'absolute',
          bottom: 24,
          left: 16,
          right: 16,
          padding: 12,
          borderRadius: 12,
          backgroundColor: isDark ? 'rgba(31,41,55,0.92)' : 'rgba(255,255,255,0.95)',
        }}
      >
        <Text style={{ color: isDark ? '#d1d5db' : '#4b5563', fontSize: 13, textAlign: 'center' }}>
          {t('location.pickerHint')}
        </Text>
      </View>
    </View>
  );
}

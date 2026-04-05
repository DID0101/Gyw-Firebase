/**
 * FCM delivery diagnostics: token vs Firestore, manifest services, battery / data-saver hints.
 * Route: /(home)/(modal)/debug-fcm
 */
import clsx from 'clsx';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '@/components/Button';
import Screen from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';
import {
  getCurrentFcmTokenForDiagnostics,
  listFirestoreFcmTokenDocs,
  refreshFcmTokenToFirestore,
} from '@/lib/fcmTokenService';
import {
  nativeGetBatteryOptimizationStatus,
  nativeGetRegisteredFcmServices,
} from '@/lib/nativeCallService';
import { useThemeClassName } from '@/lib/themeUtils';

const DebugFcmScreen = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const textColor = useThemeClassName('text-gray-900', 'text-gray-100');
  const muted = useThemeClassName('text-gray-600', 'text-gray-400');
  const mono = clsx('font-mono text-xs', textColor);

  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [storedDocs, setStoredDocs] = useState<{ docId: string; token: string; platform?: string }[]>(
    []
  );
  const [fcmServices, setFcmServices] = useState<string>('');
  const [batteryJson, setBatteryJson] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const [cur, docs, svc, bat] = await Promise.all([
        getCurrentFcmTokenForDiagnostics(),
        listFirestoreFcmTokenDocs(uid),
        Platform.OS === 'android' ? nativeGetRegisteredFcmServices() : Promise.resolve('(iOS)'),
        Platform.OS === 'android' ? nativeGetBatteryOptimizationStatus() : Promise.resolve('(iOS)'),
      ]);
      setCurrentToken(cur);
      setStoredDocs(docs);
      setFcmServices(svc);
      setBatteryJson(bat);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);

  const anyStoredMatches =
    currentToken != null && currentToken.length > 0
      ? storedDocs.some((d) => d.token === currentToken)
      : false;

  return (
    <Screen viewClassName="flex-1">
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }}
      >
        <Text className={clsx('text-xl font-bold mb-2', textColor)}>FCM delivery debug</Text>
        <Text className={clsx('text-sm mb-4', muted)}>
          Compare device token with Firestore docs under{' '}
          <Text className="font-mono text-xs">users/&#123;uid&#125;/fcmTokens</Text>. If none match,
          Cloud Functions target stale tokens.
        </Text>

        {!uid ? (
          <Text className={muted}>Sign in to load token docs.</Text>
        ) : (
          <>
            <View className="gap-2 mb-4">
              <Text className={clsx('text-base font-semibold', textColor)}>Match</Text>
              <Text
                className={clsx(
                  'text-sm font-semibold',
                  anyStoredMatches ? 'text-green-600' : 'text-amber-600'
                )}
              >
                {currentToken
                  ? anyStoredMatches
                    ? 'At least one Firestore token equals this device token.'
                    : 'MISMATCH — no Firestore doc matches current device token. Tap refresh below.'
                  : 'No current token (permission / native build?)'}
              </Text>
            </View>

            <View className="gap-2 mb-4">
              <Text className={clsx('text-base font-semibold', textColor)}>Current device token</Text>
              <Text selectable className={mono}>
                {currentToken ?? '(null)'}
              </Text>
            </View>

            <View className="gap-2 mb-4">
              <Text className={clsx('text-base font-semibold', textColor)}>Firestore fcmTokens</Text>
              {storedDocs.length === 0 ? (
                <Text className={muted}>No documents (or rules blocked read).</Text>
              ) : (
                storedDocs.map((d) => (
                  <View key={d.docId} className="mb-2 border border-gray-300 dark:border-gray-600 p-2 rounded">
                    <Text className={mono}>doc: {d.docId}</Text>
                    <Text className={mono}>platform: {d.platform ?? '?'}</Text>
                    <Text selectable className={mono}>
                      {d.token === currentToken ? '✓ same as device' : '≠ device'} — {d.token.slice(0, 48)}…
                    </Text>
                  </View>
                ))
              )}
            </View>

            {Platform.OS === 'android' && (
              <>
                <View className="gap-2 mb-4">
                  <Text className={clsx('text-base font-semibold', textColor)}>
                    MESSAGING_EVENT services (this package)
                  </Text>
                  <Text selectable className={mono}>
                    {fcmServices || '(empty)'}
                  </Text>
                </View>
                <View className="gap-2 mb-4">
                  <Text className={clsx('text-base font-semibold', textColor)}>Battery / background</Text>
                  <Text selectable className={mono}>
                    {batteryJson}
                  </Text>
                </View>
              </>
            )}

            <View className="gap-3 mt-2">
              <Button
                onPress={() => {
                  void load();
                }}
              >
                Reload
              </Button>
              <Button
                onPress={async () => {
                  try {
                    await refreshFcmTokenToFirestore(uid);
                    await load();
                  } catch (e) {
                    console.error('refreshFcmTokenToFirestore', e);
                  }
                }}
              >
                Refresh token → Firestore
              </Button>
            </View>

            {loading && (
              <View className="py-4 items-center">
                <ActivityIndicator />
              </View>
            )}
          </>
        )}

        <Pressable onPress={() => router.back()} className="py-4">
          <Text style={{ color: '#337E84' }}>Close</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
};

export default DebugFcmScreen;

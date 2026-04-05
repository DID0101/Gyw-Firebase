import clsx from 'clsx';
import { useRouter } from 'expo-router';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '@/components/Button';
import Screen from '@/components/Screen';
import { logFcmAndroidDeviceContext } from '@/lib/fcmDiagnostics';
import { useThemeClassName } from '@/lib/themeUtils';

/**
 * OEM-specific steps for reliable FCM when the app is killed / background (especially data-only).
 * After changing settings, use the confirmation button and retest incoming calls with Metro/logcat open.
 */
const FcmDiagnosticsScreen = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const textColor = useThemeClassName('text-gray-900', 'text-gray-100');
  const muted = useThemeClassName('text-gray-600', 'text-gray-400');
  const headingClass = clsx('text-base font-semibold', textColor);
  const bodyClass = clsx('text-sm leading-5', textColor);

  const logDeviceAgain = () => {
    if (Platform.OS === 'android') {
      logFcmAndroidDeviceContext();
    }
  };

  const confirmBatteryStepsDone = () => {
    console.error('[FCM TEST] Battery optimization disabled by user');
  };

  return (
    <Screen viewClassName="flex-1">
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className={clsx('text-xl font-bold mb-2', textColor)}>FCM & incoming calls</Text>
        {Platform.OS !== 'android' && (
          <Text className={clsx('text-sm mb-4', muted)}>
            Most steps below target Android OEM battery settings. On iOS, push handling differs; you can still log the
            confirmation flag when testing cross-platform instructions.
          </Text>
        )}
        <Text className={clsx('text-sm mb-4', muted)}>
          If <Text className="font-mono text-xs">setBackgroundMessageHandler</Text> never logs when the app is killed,
          OEM battery policies usually block headless JS. Apply the steps below, then confirm and retest.
        </Text>

        <View className="gap-6 mb-6">
          <View className="gap-2">
            <Text className={headingClass}>All Android devices</Text>
            <Text className={bodyClass}>
              • Disable battery optimization for this app (no restrictions / don&apos;t optimize).{'\n'}
              • Enable autostart or auto-launch where the OEM provides it.{'\n'}
              • Allow background activity for this app.{'\n'}
              • In recent apps, lock the app (pin) if your device supports it — prevents aggressive kills.
            </Text>
          </View>

          <View className="gap-2">
            <Text className={headingClass}>TECNO / HiOS</Text>
            <Text className={bodyClass}>
              Settings → Apps → Special app access → Battery optimization → this app → &quot;No restrictions&quot;.
              {'\n\n'}
              Enable Auto-start for this app.{'\n'}
              Enable &quot;Allow background activity&quot;.
            </Text>
          </View>

          <View className="gap-2">
            <Text className={headingClass}>OnePlus / OxygenOS</Text>
            <Text className={bodyClass}>
              Settings → Battery → Battery optimization → Don&apos;t optimize (this app).{'\n\n'}
              Enable Auto-launch and background activity for this app in the app info / battery details if shown.
            </Text>
          </View>

          <View className="gap-2">
            <Text className={headingClass}>What to verify in logs</Text>
            <Text className={bodyClass}>
              After a test push, look for <Text className="font-mono text-xs">📩 RAW FCM BACKGROUND</Text> or{' '}
              <Text className="font-mono text-xs">FALLBACK CALL UI TRIGGERED</Text> (notification-open path or CallKeep
              failure). The app also shows incoming UI from a notification tap even if headless JS did not run.
            </Text>
          </View>
        </View>

        <View className="gap-3">
          <Button onPress={() => router.push('/(home)/(modal)/debug-fcm' as never)}>
            Open FCM delivery debug (token vs Firestore)
          </Button>
          <Button
            onPress={() => {
              logDeviceAgain();
              confirmBatteryStepsDone();
            }}
          >
            I finished these steps — log confirmation + device hint
          </Button>
          <Pressable onPress={confirmBatteryStepsDone} className="py-2">
            <Text className={clsx('text-center text-sm', muted)}>Log confirmation only</Text>
          </Pressable>
          <Button variant="text" onPress={() => router.back()}>
            Close
          </Button>
        </View>
      </ScrollView>
    </Screen>
  );
};

export default FcmDiagnosticsScreen;

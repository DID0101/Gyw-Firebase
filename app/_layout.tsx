import '@/lib/appInit';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo } from 'react';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { enableFreeze } from 'react-native-screens';

import OfflineBanner from '@/components/OfflineBanner';
import { ToastHost } from '@/components/Toast';
import NetworkAuditScreenTracker from '@/components/debug/NetworkAuditScreenTracker';
import { RootErrorBoundary } from '@/components/RootErrorBoundary';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { logStartupStep } from '@/lib/debug/releaseStartupTrace';
import { markAppStart } from '@/lib/debug/appStartupMarkers';
import { wrapRootComponent } from '@/lib/reliability/SentryManager';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../global.css';
import '../i18n/config';

LogBox.ignoreLogs([
  '[expo-av]: Expo AV has been deprecated',
  'i18next',
  'Locize',
  'locize.com',
  'Requiring unknown module',
]);

enableFreeze(true);

if (!__DEV__) {
  console.log = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.debug = () => {};
}

const AppContent = () => {
  const { colorScheme } = useTheme();
  const statusBarStyle = useMemo(() => (colorScheme === 'dark' ? 'light' : 'dark'), [colorScheme]);

  return (
    <>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(home)" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style={statusBarStyle} />
    </>
  );
};

const RootLayoutContent = () => {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <RootErrorBoundary>
          <AuthProvider>
            <AppContent />
            <OfflineBanner />
            <ToastHost />
            {__DEV__ ? <NetworkAuditScreenTracker /> : null}
          </AuthProvider>
        </RootErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

const RootLayout = () => {
  useEffect(() => {
    try {
      markAppStart(8, { screen: 'RootLayout' });
      logStartupStep('STEP_8_NAVIGATION_MOUNTED', { screen: 'RootLayout' });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('APP_START_8_FAILED', e);
    }
  }, []);
  return (
    <ThemeProvider>
      <RootLayoutContent />
    </ThemeProvider>
  );
};

export default wrapRootComponent(RootLayout);

import '@/lib/appInit';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo } from 'react';
import { LogBox, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { enableFreeze } from 'react-native-screens';

import { NotificationHandler } from '@/components/NotificationHandler';
import { AuthProvider } from '@/contexts/AuthContext';
import { setupNotificationChannel } from '@/lib/notificationSetup';

// Suppress expo-av deprecation warning until migration to expo-audio (SDK 54)
LogBox.ignoreLogs([
  '[expo-av]: Expo AV has been deprecated',
  'i18next',
  'Locize',
  'locize.com',
]);
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import '../global.css';
import '../i18n/config';

// Enable screen freeze for better performance (prevents inactive screens from re-rendering)
enableFreeze(true);

// Disable console logs in production for better performance
if (!__DEV__) {
  console.log = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.debug = () => {};
}

const RootLayoutContent = () => {
  // Create incoming_calls channel at app entry (Android) so it exists when app is killed.
  useEffect(() => {
    if (Platform.OS === 'android') setupNotificationChannel().catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <NotificationHandler />
        <AppContent />
      </AuthProvider>
    </GestureHandlerRootView>
  );
};

const AppContent = () => {
  const { colorScheme } = useTheme();
  const statusBarStyle = useMemo(() => colorScheme === 'dark' ? 'light' : 'dark', [colorScheme]);

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

const RootLayout = () => {
  return (
    <ThemeProvider>
      <RootLayoutContent />
    </ThemeProvider>
  );
};

export default RootLayout;

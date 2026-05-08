import '@/lib/appInit';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useMemo } from 'react';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { enableFreeze } from 'react-native-screens';

import { RootErrorBoundary } from '@/components/RootErrorBoundary';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import '../global.css';
import '../i18n/config';

const SafeAuthProvider =
  typeof AuthProvider === 'function' ? AuthProvider : ({ children }: any) => children;

LogBox.ignoreLogs([
  '[expo-av]: Expo AV has been deprecated',
  'i18next',
  'Locize',
  'locize.com',
]);

enableFreeze(true);

if (!__DEV__) {
  console.log = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.debug = () => {};
}

const RootLayoutContent = () => {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <RootErrorBoundary>
        <SafeAuthProvider>
          <AppContent />
        </SafeAuthProvider>
      </RootErrorBoundary>
    </GestureHandlerRootView>
  );
};

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

const RootLayout = () => {
  return (
    <ThemeProvider>
      <RootLayoutContent />
    </ThemeProvider>
  );
};

export default RootLayout;

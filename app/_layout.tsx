import '@/lib/appInit';
import * as ExpoLinking from 'expo-linking';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef } from 'react';
import { AppState, Linking, LogBox, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { enableFreeze } from 'react-native-screens';

import { RootErrorBoundary } from '@/components/RootErrorBoundary';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { isIncomingCallPushType, subscribeForegroundFcmCallInvites } from '@/lib/incomingCallInvite';
import { registerIncomingCallNavigator } from '@/lib/incomingCallNavigation';
import { bootstrapAndroidCallSupport, ensureFcmTokenSaved, testFirestoreWrite } from '@/lib/registerBackgroundMessaging';
import '../global.css';
import '../i18n/config';

const SafeAuthProvider =
  typeof AuthProvider === 'function' ? AuthProvider : ({ children }: any) => children;

// Suppress expo-av deprecation warning until migration to expo-audio (SDK 54)
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
  const router = useRouter();
  const initialCallNavigatedRef = useRef(false);

  useEffect(() => {
    registerIncomingCallNavigator((callId, opts) => {
      const autoAccept = opts?.autoAccept === true;
      router.replace({
        pathname: '/(home)/call/[id]',
        params: autoAccept ? { id: callId, accept: '1' } : { id: callId },
      } as never);
    });
    return () => registerIncomingCallNavigator(null);
  }, [router]);

  useEffect(() => {
    const unsub = subscribeForegroundFcmCallInvites();
    return () => unsub();
  }, []);

  useEffect(() => {
    bootstrapAndroidCallSupport();

    if (Platform.OS === 'android') {
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          void ensureFcmTokenSaved();
        }
      });
      return () => sub.remove();
    }
  }, []);

  useEffect(() => {
    setTimeout(() => void testFirestoreWrite(), 3000);
  }, []);

  // Android: listen for incoming-call intents fired by MainActivity.onNewIntent (background→foreground)
  // and MainActivity.onCreate (cold start). GywCallModule emits 'GywIncomingCallFromIntent' with
  // { callId, autoAccept } when the user taps the GywCallService notification.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const module = NativeModules.GywCallModule;
    if (!module) return;
    const emitter = new NativeEventEmitter(module);
    const sub = emitter.addListener(
      'GywIncomingCallFromIntent',
      (payload: { callId: string; autoAccept: boolean }) => {
        if (!payload?.callId) return;
        router.replace({
          pathname: '/(home)/call/[id]',
          params: payload.autoAccept ? { id: payload.callId, accept: '1' } : { id: payload.callId },
        } as never);
      }
    );
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;

    const navigateToIncomingCall = (callId: string, autoAccept: boolean) => {
      if (cancelled || initialCallNavigatedRef.current || !callId) return;
      initialCallNavigatedRef.current = true;
      router.replace({
        pathname: '/(home)/call/[id]',
        params: autoAccept ? { id: callId, accept: '1' } : { id: callId },
      } as never);
    };

    (async () => {
      try {
        const notifee = require('@notifee/react-native').default;
        const initial = await notifee.getInitialNotification();
        const d = initial?.notification?.data;
        if (d && isIncomingCallPushType(String(d.type)) && d.callId) {
          navigateToIncomingCall(String(d.callId), false);
          return;
        }
      } catch (e) {
        if (__DEV__) console.warn('[Notifee] getInitialNotification', e);
      }

      try {
        const initialUrl = await Linking.getInitialURL();
        if (!initialUrl?.includes('/call/')) return;
        const match = initialUrl.match(/\/call\/([^?]+)/);
        if (match?.[1]) {
          const parsed = ExpoLinking.parse(initialUrl);
          const autoAccept = parsed.queryParams?.accept === '1';
          navigateToIncomingCall(decodeURIComponent(match[1]), autoAccept);
        }
      } catch (e) {
        if (__DEV__) console.warn('[Linking] getInitialURL', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
      if (!url.includes('/call/')) return;
      const match = url.match(/\/call\/([^?]+)/);
      if (!match?.[1]) return;
      const id = decodeURIComponent(match[1]);
      const parsed = ExpoLinking.parse(url);
      const autoAccept = parsed.queryParams?.accept === '1';
      router.push({
        pathname: '/(home)/call/[id]',
        params: autoAccept ? { id, accept: '1' } : { id },
      } as never);
    };

    const sub = Linking.addEventListener('url', handleUrl);
    return () => sub.remove();
  }, [router]);

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

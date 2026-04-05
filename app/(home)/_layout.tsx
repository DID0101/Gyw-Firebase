import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, usePathname, useRouter } from 'expo-router';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';

import ScreenLoading from '@/components/ScreenLoading';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { subscribeIncomingRingingCalls } from '@/lib/incomingCallFirestoreListener';
import { loadFromStorage, preloadAppData } from '@/lib/services/preloadService';

// RN Firebase Firestore (single app from rnFirebase)
import { getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';

let rnFirestoreMod: typeof import('@react-native-firebase/firestore') | null = null;
if (Platform.OS !== 'web') {
  try {
    rnFirestoreMod = require('@react-native-firebase/firestore');
  } catch (_) {}
}
const useNativeFirestore = hasRnFirebase && !!rnFirestoreMod;

const HomeLayout = () => {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef<string>('');
  pathnameRef.current = pathname ?? '';

  const { user, loading: authLoading } = useAuth();
  const [setupComplete, setSetupComplete] = useState(false);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const hasNavigatedToSignIn = useRef(false);
  const isNavigatingRef = useRef(false);
  const setupDoneForUidRef = useRef<string | null>(null);

  // 1. Initial user setup
  useEffect(() => {
    if (authLoading) return;

    if (!user?.uid) {
      setupDoneForUidRef.current = null;
      if (!hasNavigatedToSignIn.current && !isNavigatingRef.current) {
        hasNavigatedToSignIn.current = true;
        isNavigatingRef.current = true;
        setTimeout(() => {
          router.replace('/sign-in');
          setTimeout(() => {
            isNavigatingRef.current = false;
          }, 100);
        }, 0);
      }
      return;
    }

    hasNavigatedToSignIn.current = false;
    isNavigatingRef.current = false;

    if (setupDoneForUidRef.current === user.uid) return;
    setupDoneForUidRef.current = user.uid;

    const setupUser = async () => {
      try {
        const pendingUsername = await AsyncStorage.getItem('pendingUsername');
        const pendingPhone = await AsyncStorage.getItem('pendingPhone');

        let exists = false;
        if (useNativeFirestore && rnFirestoreMod) {
          const rnDb = getRnFirestore();
          const userRef = rnFirestoreMod.doc(rnDb, 'users', user.uid);
          const snap = await rnFirestoreMod.getDoc(userRef);
          exists = !!snap.exists;
        } else {
          const snap = await getDoc(doc(db, 'users', user.uid));
          exists = !!snap.exists;
        }

        if (!exists) {
          const userData = {
            uid: user.uid,
            firstName: user?.displayName?.split(' ')[0] || '',
            lastName: user?.displayName?.split(' ').slice(1).join(' ') || '',
            username: pendingUsername || '',
            phoneNumber: pendingPhone || user?.phoneNumber || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          if (useNativeFirestore && rnFirestoreMod) {
            const rnDb = getRnFirestore();
            const userRef = rnFirestoreMod.doc(rnDb, 'users', user.uid);
            await rnFirestoreMod.setDoc(userRef, userData);
          } else {
            await setDoc(doc(db, 'users', user.uid), userData);
          }
        } else if (pendingUsername || pendingPhone) {
          const updateData: any = { updatedAt: new Date().toISOString() };
          if (pendingUsername) updateData.username = pendingUsername;
          if (pendingPhone) updateData.phoneNumber = pendingPhone;
          if (useNativeFirestore && rnFirestoreMod) {
            const rnDb = getRnFirestore();
            const userRef = rnFirestoreMod.doc(rnDb, 'users', user.uid);
            await rnFirestoreMod.setDoc(userRef, updateData, { merge: true });
          } else {
            await setDoc(doc(db, 'users', user.uid), updateData, { merge: true });
          }
        }

        if (pendingUsername) await AsyncStorage.removeItem('pendingUsername');
        if (pendingPhone) await AsyncStorage.removeItem('pendingPhone');
      } catch (error) {
        if (__DEV__) console.error('Error setting up user:', error);
      } finally {
        setSetupComplete(true);
      }
    };

    setupUser();
  }, [user?.uid, authLoading, router]);

  // 1.1 Load cached data + preload
  useEffect(() => {
    if (!user?.uid || !setupComplete) return;
    loadFromStorage().catch(() => {});
    preloadAppData(user.uid).catch(() => {});
  }, [user?.uid, setupComplete]);

  // 1.2 Incoming calls while app is foregrounded (FCM onMessage is easy to miss; Firestore is immediate)
  useEffect(() => {
    if (!user?.uid || !setupComplete) return;

    const unsub = subscribeIncomingRingingCalls(user.uid, (callId) => {
      const p = pathnameRef.current;
      if (p.includes(`/call/${callId}`)) return;
      router.push({ pathname: '/(home)/call/[id]', params: { id: callId } } as never);
    });

    return () => unsub();
  }, [user?.uid, setupComplete, router]);

  // 2. Presence heartbeat
  useEffect(() => {
    if (!user?.uid) return;

    const updateLastActive = async () => {
      try {
        if (useNativeFirestore && rnFirestoreMod) {
          const rnDb = getRnFirestore();
          const userRef = rnFirestoreMod.doc(rnDb, 'users', user.uid);
          await rnFirestoreMod.setDoc(userRef, { lastActive: rnFirestoreMod.serverTimestamp() }, { merge: true });
        } else {
          await setDoc(doc(db, 'users', user.uid), { lastActive: serverTimestamp() }, { merge: true });
        }
      } catch (error) {
        if (__DEV__) console.error('Error updating lastActive:', error);
      }
    };

    updateLastActive();
    const interval = setInterval(updateLastActive, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user?.uid]);

  // 3. AppState listener to update presence
  useEffect(() => {
    if (!user?.uid) return;

    const handleAppStateChange = (nextState: AppStateStatus) => {
      const wasActive = appStateRef.current === 'active';
      const isActive = nextState === 'active';
      appStateRef.current = nextState;

      if (wasActive !== isActive) {
        if (useNativeFirestore && rnFirestoreMod) {
          const rnDb = getRnFirestore();
          const userRef = rnFirestoreMod.doc(rnDb, 'users', user.uid);
          rnFirestoreMod
            .setDoc(
              userRef,
              { lastActive: rnFirestoreMod.serverTimestamp(), isOnline: isActive },
              { merge: true }
            )
            .catch(() => {});
        } else {
          setDoc(
            doc(db, 'users', user.uid),
            { lastActive: serverTimestamp(), isOnline: isActive },
            { merge: true }
          ).catch(() => {});
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [user?.uid]);

  if (authLoading || (user && !setupComplete)) {
    return <ScreenLoading />;
  }

  if (!user) return null;

  return (
    <Stack screenOptions={{ animation: 'none' }}>
      <Stack.Screen name="(modal)" options={{ presentation: 'modal', headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
      <Stack.Screen
        name="call/[id]"
        options={{
          headerShown: false,
          animation: 'none',
          gestureEnabled: false,
        }}
      />
    </Stack>
  );
};

export default HomeLayout;


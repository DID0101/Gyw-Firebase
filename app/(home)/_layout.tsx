import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useRouter } from 'expo-router';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import ScreenLoading from '@/components/ScreenLoading';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { db } from '@/lib/firebase';
import { loadFromStorage, preloadAppData } from '@/lib/services/preloadService';
import { registerPushToken } from '@/lib/pushTokenService';

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
  const { user, loading: authLoading } = useAuth();
  const { isDark } = useTheme();
  const [setupComplete, setSetupComplete] = useState(false);
  const routerRef = useRef(router);
  routerRef.current = router;
  
  const hasNavigatedToSignIn = useRef(false);
  const isNavigatingRef = useRef(false);
  const setupDoneForUidRef = useRef<string | null>(null);

  // 1. Initial User Setup
  useEffect(() => {
    if (authLoading) return; // Wait for auth to load
    
    if (!user?.uid) {
      setupDoneForUidRef.current = null;
      // Only navigate once to prevent infinite loops
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

    // Run setup only once per uid to avoid re-triggering setState in a loop
    if (setupDoneForUidRef.current === user.uid) return;
    setupDoneForUidRef.current = user.uid;

    const setupUser = async () => {
      try {
        const pendingUsername = await AsyncStorage.getItem('pendingUsername');
        const pendingPhone = await AsyncStorage.getItem('pendingPhone');

        let userDoc: { exists: () => boolean };
        if (useNativeFirestore && rnFirestoreMod) {
          const rnDb = getRnFirestore();
          const userRef = rnFirestoreMod.doc(rnDb, 'users', user.uid);
          const snap = await rnFirestoreMod.getDoc(userRef);
          userDoc = { exists: () => snap.exists };
        } else {
          userDoc = await getDoc(doc(db, 'users', user.uid));
        }

        if (!userDoc.exists()) {
          const userData = {
            uid: user.uid,
            firstName: user.displayName?.split(' ')[0] || '',
            lastName: user.displayName?.split(' ').slice(1).join(' ') || '',
            username: pendingUsername || '',
            phoneNumber: pendingPhone || user.phoneNumber || '',
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
        setSetupComplete((prev) => (prev ? prev : true));
      }
    };

    setupUser();
  }, [user?.uid, authLoading]);

  // 1.1. Load from storage first (instant), then preload from Firestore
  useEffect(() => {
    if (!user?.uid || !setupComplete) return;
    
    // Step 1: Load from AsyncStorage instantly (no network needed)
    loadFromStorage().catch(() => {
      // Silently fail - continue with empty cache
    });
    
    // Step 2: Preload from Firestore in background (silent sync)
    // This runs async and doesn't block UI
    preloadAppData(user.uid).catch(() => {
      // Silently fail - AsyncStorage data is already loaded
    });

    // Register FCM token for incoming call notifications
    registerPushToken(user.uid).catch(() => {});
  }, [user?.uid, setupComplete]);

  // 2. Presence Heartbeat
  useEffect(() => {
    if (!user) return;

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

  if (authLoading || (user && !setupComplete)) {
    return <ScreenLoading />;
  }

  if (!user) return null;

  return (
    <Stack>
      <Stack.Screen name="(modal)" options={{ presentation: 'modal', headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="incoming-call/[id]" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="call/[id]" options={{ headerShown: false, animation: 'none' }} />
    </Stack>
  );
};

export default HomeLayout;

import { Redirect, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { getNetworkSnapshot } from '@/lib/networkState';
import { logAuthReliability } from '@/lib/reliability/reliabilityLog';
import { getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';

let rnFirestoreMod: any = null;
if (Platform.OS !== 'web') {
  try {
    rnFirestoreMod = require('@react-native-firebase/firestore');
  } catch (e) {}
}

const PROFILE_CACHE_KEY = 'profileCompleteCache:v1';

async function readProfileCache(uid: string): Promise<boolean | null> {
  try {
    const raw = await AsyncStorage.getItem(`${PROFILE_CACHE_KEY}:${uid}`);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
}

async function writeProfileCache(uid: string, complete: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(`${PROFILE_CACHE_KEY}:${uid}`, complete ? '1' : '0');
  } catch {
    /* non-fatal */
  }
}

const AuthLayout = () => {
  const { user, loading } = useAuth();
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const lastCheckedUidRef = useRef<string | null>(null);

  useEffect(() => {
    const uid = user?.uid ?? null;
    if (!uid) {
      lastCheckedUidRef.current = null;
      setProfileComplete((prev) => (prev === null ? prev : null));
      return;
    }
    if (lastCheckedUidRef.current === uid) return;
    lastCheckedUidRef.current = uid;

    let cancelled = false;
    const check = async () => {
      const cached = await readProfileCache(uid);
      if (cached != null && !cancelled) {
        setProfileComplete((prev) => (prev === cached ? prev : cached));
      }

      try {
        let exists = false;
        let complete = false;
        if (Platform.OS !== 'web' && hasRnFirebase && rnFirestoreMod) {
          const rnDb = getRnFirestore();
          const snap = await rnFirestoreMod.getDoc(rnFirestoreMod.doc(rnDb, 'users', uid));
          const docExists =
            typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
          if (docExists) {
            exists = true;
            const d = typeof snap.data === 'function' ? snap.data() : snap.data;
            complete = !!(d?.firstName && d?.username);
          }
        } else {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            exists = true;
            const d = snap.data();
            complete = !!(d?.firstName && d?.username);
          }
        }
        const next = exists && complete;
        await writeProfileCache(uid, next);
        if (!cancelled) {
          setProfileComplete((prev) => (prev === next ? prev : next));
        }
      } catch (err) {
        logAuthReliability('PROFILE_CHECK_DEFER', {
          uid: uid.slice(0, 8),
          online: getNetworkSnapshot().isOnline,
          reason: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) {
          // On network error: keep cached value or null (unknown) — never force incomplete.
          if (cached == null) {
            setProfileComplete((prev) => (prev === null ? prev : null));
          }
        }
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  if (loading) return null;

  // User signed in but profile incomplete → show sign-up (profile step only)
  if (user && profileComplete === false) {
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="sign-up" initialParams={{ completeProfile: '1' }} />
      </Stack>
    );
  }

  if (user && profileComplete === true) {
    return <Redirect href={'/(home)/(tabs)/chats'} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
    </Stack>
  );
};

export default AuthLayout;

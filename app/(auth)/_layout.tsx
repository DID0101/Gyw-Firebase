import { Redirect, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';

let rnFirestoreMod: any = null;
if (Platform.OS !== 'web') {
  try {
    rnFirestoreMod = require('@react-native-firebase/firestore');
  } catch (e) {}
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
    // Avoid re-running async check for same uid (prevents loop when context re-renders)
    if (lastCheckedUidRef.current === uid) return;
    lastCheckedUidRef.current = uid;

    let cancelled = false;
    const check = async () => {
      try {
        let exists = false;
        let complete = false;
        if (Platform.OS !== 'web' && hasRnFirebase && rnFirestoreMod) {
          const rnDb = getRnFirestore();
          const snap = await rnFirestoreMod.getDoc(rnFirestoreMod.doc(rnDb, 'users', uid));
          if (snap.exists) {
            exists = true;
            const d = snap.data();
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
        if (!cancelled) {
          setProfileComplete((prev) => (prev === next ? prev : next));
        }
      } catch {
        if (!cancelled) {
          setProfileComplete((prev) => (prev === false ? prev : false));
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

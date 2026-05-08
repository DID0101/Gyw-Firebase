import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { Stack, usePathname, useRouter } from 'expo-router';
import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus, InteractionManager, Platform } from 'react-native';

import { CallManagerHost } from '@/components/CallManagerHost';
import ScreenLoading from '@/components/ScreenLoading';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { loadFromStorage, preloadAppData } from '@/lib/services/preloadService';
import { updateCallStatus } from '@/lib/services/callService';
import { useCallSessionStore } from '@/store/callSessionStore';

// RN Firebase Firestore (single app from rnFirebase)
import { getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';

let rnFirestoreMod: typeof import('@react-native-firebase/firestore') | null = null;
if (Platform.OS !== 'web') {
  try {
    rnFirestoreMod = require('@react-native-firebase/firestore');
  } catch (_) {}
}
const useNativeFirestore = hasRnFirebase && !!rnFirestoreMod;
const CALL_RELIABILITY_PROMPT_KEY = 'callReliabilityPrompt:v1';

const HomeLayout = () => {
  const router = useRouter();
  const pathname = usePathname();

  const { user, loading: authLoading } = useAuth();
  const [setupComplete, setSetupComplete] = useState(false);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const hasNavigatedToSignIn = useRef(false);
  const isNavigatingRef = useRef(false);
  const setupDoneForUidRef = useRef<string | null>(null);
  const pathnameRef = useRef(pathname);

  // Keep pathnameRef current so the incoming-call guard always sees latest route
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  // Android: open chat from notification / inline-reply deep link (gyw://chat/{id}?…)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const openFromUrl = (url: string) => {
      if (!url || !url.startsWith('gyw://chat/')) return;
      try {
        const noScheme = url.replace(/^gyw:\/\//, '');
        const pathPart = noScheme.startsWith('chat/') ? noScheme.slice('chat/'.length) : '';
        const [idRaw, queryRaw] = pathPart.split('?', 2);
        const chatId = decodeURIComponent(idRaw || '');
        if (!chatId) return;
        const qs = queryRaw ? new URLSearchParams(queryRaw) : new URLSearchParams();
        const q: string[] = [];
        if (qs.get('fromNotif')) q.push(`fromNotif=${encodeURIComponent(qs.get('fromNotif') || '1')}`);
        if (qs.get('markRead') === '1') q.push('markRead=1');
        if (qs.get('fromReply') === '1') q.push('fromReply=1');
        const suffix = q.length ? `?${q.join('&')}` : '';
        router.push(`/chat/${chatId}${suffix}` as never);
      } catch {
        /* ignore malformed deep links */
      }
    };
    void Linking.getInitialURL().then((u) => {
      if (u) openFromUrl(u);
    });
    const sub = Linking.addEventListener('url', (e) => openFromUrl(e.url));
    return () => sub.remove();
  }, [router]);

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

  // 1.1 Load cached data then preload — after first interactions so home shell paints quickly.
  useEffect(() => {
    if (!user?.uid || !setupComplete) return;
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        await loadFromStorage().catch(() => {});
        if (cancelled) return;
        await preloadAppData(user.uid).catch(() => {});
      })();
    });
    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [user?.uid, setupComplete]);

  // 1.15 Contacts — defer so startup / first tab transition stays responsive.
  useEffect(() => {
    if (Platform.OS === 'web' || !user?.uid || !setupComplete) return;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const Contacts = await import('expo-contacts');
          const s = await Contacts.getPermissionsAsync();
          if (!s.granted && s.canAskAgain !== false) {
            await Contacts.requestPermissionsAsync();
          }
        } catch {
          /* ignore */
        }
      })();
    }, 2800);
    return () => clearTimeout(t);
  }, [user?.uid, setupComplete]);

  // 1.16 Android: observe battery + full-screen-intent capability (no auto system UI).
  //
  // Previously this effect opened battery optimization + FSI settings on every sign-in.
  // That navigates away from the app and feels like an "exit" — especially when a call
  // arrives. IncomingCallBridge still exposes requestIgnoreBatteryOptimizations /
  // openFullScreenIntentSettings for a dedicated settings screen if you add one.
  useEffect(() => {
    if (Platform.OS !== 'android' || !user?.uid || !setupComplete) return;
    void (async () => {
      try {
        const { NativeModules } = await import('react-native');
        const bridge = NativeModules.IncomingCallBridge;
        if (!bridge) return;
        const ignoring: boolean = await bridge.isIgnoringBatteryOptimizations();
        const canFsi: boolean = await bridge.canUseFullScreenIntent();
        if (__DEV__ && (!ignoring || !canFsi)) {
          console.warn(
            '[HomeLayout] Android call reliability: batteryOpt=',
            ignoring,
            ' fullScreenIntent=',
            canFsi,
          );
        }
        if (!ignoring || !canFsi) {
          const alreadyPrompted = await AsyncStorage.getItem(CALL_RELIABILITY_PROMPT_KEY);
          if (!alreadyPrompted) {
            Alert.alert(
              'Improve call reliability',
              'Allow battery optimization exemption and full-screen call permission for best incoming-call reliability on this device.',
              [
                { text: 'Not now', style: 'cancel' },
                {
                  text: 'Open settings',
                  onPress: () => {
                    void (async () => {
                      try {
                        if (!ignoring) await bridge.requestIgnoreBatteryOptimizations();
                        if (!canFsi) await bridge.openFullScreenIntentSettings();
                      } catch {
                        /* ignore */
                      }
                    })();
                  },
                },
              ],
            );
            await AsyncStorage.setItem(CALL_RELIABILITY_PROMPT_KEY, new Date().toISOString());
          }
        }
      } catch {
        /* non-fatal */
      }
    })();
  }, [user?.uid, setupComplete]);

  // Shared handler — Firestore (1.2) + legacy paths. Android ringing is native (FCM → FSI);
  // iOS uses PushKit CallKit + in-app navigation here.
  const handleIncomingCallRef = useRef<
    (callId: string, meta?: { callerName?: string; type?: 'audio' | 'video' }) => Promise<void>
  >(async () => {});

  useEffect(() => {
    handleIncomingCallRef.current = async (callId, meta) => {
      if (pathnameRef.current?.includes(`/call/${callId}`)) return;
      if (pathnameRef.current?.includes('/call/')) return;
      const activeId = useCallSessionStore.getState().activeSessionCallId;
      if (activeId && activeId !== callId) {
        try {
          await updateCallStatus(callId, 'busy');
        } catch (e) {
          if (__DEV__) console.warn('[incomingCall] busy auto-reject failed', e);
        }
        return;
      }
      if (Platform.OS === 'android') {
        // Incoming UI + ring: GywFirebaseMessagingService (FCM) → GywIncomingCallService →
        // IncomingCallActivity (native). JS does not navigate — deep link from acceptCall() does.
        return;
      }

      if (!useCallSessionStore.getState().shouldNavigateToIncomingCall(callId)) return;

      if (__DEV__) console.log('[incomingCall] Navigating to call screen:', callId);
      router.push(`/(home)/call/${callId}` as any);
    };
    // Ref assignment only — pathname/session read via refs + stores inside handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1.2 Incoming call listener — phone B rings when app is in the foreground/background
  // Fires as soon as a new call document with status='ringing' appears for this user.
  useEffect(() => {
    if (!user?.uid) return;

    const uid = user.uid;

    let unsubscribe: (() => void) | null = null;

    if (useNativeFirestore && rnFirestoreMod) {
      // Native path (Android / iOS) — shares auth with native Firebase
      const rnDb = getRnFirestore();
      const callsRef = rnFirestoreMod.collection(rnDb, 'calls');
      // NOTE: `initiateCall` CF writes `calleeId` — NOT `receiverId`.
      // The legacy `receiverId` field is only present on documents written
      // directly by the client before the CF was introduced.
      const q = rnFirestoreMod.query(
        callsRef,
        rnFirestoreMod.where('calleeId', '==', uid),
        rnFirestoreMod.where('status', '==', 'ringing'),
      );
      unsubscribe = rnFirestoreMod.onSnapshot(
        q,
        (snap: any) => {
          snap.docChanges().forEach((change: any) => {
            if (change.type === 'added') {
              const d =
                typeof change.doc.data === 'function' ? change.doc.data() : change.doc.data ?? {};
              const t = d.type === 'video' ? 'video' : 'audio';
              void handleIncomingCallRef.current(change.doc.id, {
                callerName: typeof d.callerName === 'string' ? d.callerName : undefined,
                type: t,
              });
            }
          });
        },
        (err: any) => {
          if (__DEV__) console.warn('[incomingCall] listener error:', err?.message);
        }
      );
    } else {
      // Web path
      const q = query(
        collection(db, 'calls'),
        where('calleeId', '==', uid),
        where('status', '==', 'ringing'),
      );
      unsubscribe = onSnapshot(
        q,
        (snap) => {
          snap.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const d = change.doc.data();
              const t = d.type === 'video' ? 'video' : 'audio';
              void handleIncomingCallRef.current(change.doc.id, {
                callerName: typeof d.callerName === 'string' ? d.callerName : undefined,
                type: t,
              });
            }
          });
        },
        (err) => {
          if (__DEV__) console.warn('[incomingCall] listener error:', err?.message);
        }
      );
    }

    return () => { unsubscribe?.(); };
  }, [user?.uid]);

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
    // 5m heartbeat — AppState still updates immediately on foreground/background.
    const interval = setInterval(updateLastActive, 5 * 60 * 1000);
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

  // Don't block the call screen behind auth loading or the Firestore setup round-trip.
  // The call screen manages its own auth check via useAuth(); it must be reachable
  // immediately on cold start so incoming call navigation lands without delay.
  const isCallRoute = !!pathname?.includes('/call/');

  if (!isCallRoute && (authLoading || (user && !setupComplete))) {
    return <ScreenLoading />;
  }

  if (!user) return null;

  return (
    <>
      <CallManagerHost />
      <Stack screenOptions={{ animation: 'slide_from_right', animationDuration: 200 }}>
        <Stack.Screen name="(modal)" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="chat/[id]"
          options={{
            headerShown: false,
            freezeOnBlur: true,
            // Faster than default slide (~200ms): cuts perceived tap→room lag.
            animation: 'fade',
            animationDuration: 120,
          }}
        />
        <Stack.Screen
          name="call/[id]"
          options={{
            headerShown: false,
            animation: 'none',
            gestureEnabled: false,
          }}
        />
      </Stack>
    </>
  );
};

export default HomeLayout;


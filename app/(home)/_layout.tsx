import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { Stack, usePathname, useRouter } from 'expo-router';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Alert,
    AppState,
    AppStateStatus,
    InteractionManager,
    NativeEventEmitter,
    NativeModules,
    Platform,
} from 'react-native';

import { CallManagerHost } from '@/components/CallManagerHost';
import ScreenLoading from '@/components/ScreenLoading';
import { useAuth } from '@/contexts/AuthContext';
import { handleAnswerCallNavigation } from '@/lib/call/handleAnswerCallNavigation';
import { db } from '@/lib/firebase';
import { callManagerActionsRef } from '@/lib/hooks/useCallManager';
import { releaseImageMemoryCache } from '@/lib/memoryPressure';
import { refreshNetworkSnapshot } from '@/lib/networkState';
import { initReliability } from '@/lib/reliability/initReliability';
import { setSentryScreen } from '@/lib/reliability/SentryManager';
import { loadFromStorage, preloadAppData, preloadAppDataOnForeground } from '@/lib/services/preloadService';
import { useCallSessionStore } from '@/store/callSessionStore';
import { useCallStore } from '@/store/callStore';
import { useChatStore } from '@/store/chatStore';
import { useContactsStore } from '@/store/contactsStore';

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
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();

  const { user, loading: authLoading } = useAuth();
  const [setupComplete, setSetupComplete] = useState(false);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const foregroundPresenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasNavigatedToSignIn = useRef(false);
  const isNavigatingRef = useRef(false);
  const setupDoneForUidRef = useRef<string | null>(null);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    initReliability();
  }, []);

  // Keep pathnameRef current so the incoming-call guard always sees latest route
  useEffect(() => {
    pathnameRef.current = pathname;
    if (pathname) setSentryScreen(pathname);
    if (__DEV__ && pathname?.includes('/call/')) {
      console.log('ACCEPT_PATHNAME_CALL_ROUTE', { pathname, ts: Date.now() });
    }
  }, [pathname]);

  // Android: gyw://call/{id}?accept=1 — callee accept (native full-screen / notification)
  useEffect(() => {
    if (Platform.OS !== 'android' || !user?.uid) return;

    const openCallFromUrl = (url: string) => {
      if (!url) return;
      const normalized = url.replace(/^exp\+gyw:\/\//, 'gyw://');
      if (!normalized.includes('gyw://call/')) return;
      try {
        const noScheme = normalized.replace(/^gyw:\/\//, '');
        const pathPart = noScheme.startsWith('call/') ? noScheme.slice('call/'.length) : '';
        const [idRaw, queryRaw] = pathPart.split('?', 2);
        const callId = decodeURIComponent(idRaw || '').trim();
        if (!callId) return;
        const qs = queryRaw ? new URLSearchParams(queryRaw) : new URLSearchParams();
        if (qs.get('accept') !== '1') return;
        const callType = qs.get('callType') === 'video' ? 'video' : 'audio';
        console.log('ACCEPT_DEEPLINK_URL', { callId, callType, url: normalized });
        void handleAnswerCallNavigation(router, { callId, callType });
      } catch {
        /* ignore malformed deep links */
      }
    };

    void Linking.getInitialURL().then((u) => {
      if (u) openCallFromUrl(u);
    });
    const sub = Linking.addEventListener('url', (e) => openCallFromUrl(e.url));
    return () => sub.remove();
  }, [user?.uid, router]);

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
        const chatPath = `/chat/${chatId}${suffix}` as never;
        // Cold start / notification: replace so GO_BACK is not dispatched on an empty stack.
        if (qs.get('fromNotif')) {
          router.replace(chatPath);
        } else {
          router.push(chatPath);
        }
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

    // Paint home shell immediately — user doc verify/create runs in background.
    setSetupComplete(true);

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
      }
    };

    void setupUser();
  }, [user?.uid, authLoading, router]);

  // Warm MMKV caches as soon as auth resolves (do not wait for Firestore user setup).
  useEffect(() => {
    if (authLoading || !user?.uid) return;
    let cancelled = false;
    void loadFromStorage().catch(() => {});
    void import('@/store/contactsStore').then(({ useContactsStore }) => {
      if (!cancelled) void useContactsStore.getState().hydrateFromStorage().catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [user?.uid, authLoading]);

  // Firestore preload after first frame — never blocks home shell.
  useEffect(() => {
    if (!user?.uid || authLoading) return;
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      void preloadAppData(user.uid).catch(() => {});
    });
    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [user?.uid, authLoading]);

  // 1.15 Foreground reconnect — debounced, stale-gated (avoid full contact scan every resume).
  useEffect(() => {
    if (Platform.OS === 'web' || !user?.uid || !setupComplete) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let interactionTask: { cancel?: () => void } | null = null;
    let cancelled = false;

    const runForegroundReconnect = () => {
      if (cancelled) return;
      refreshNetworkSnapshot();
      void useContactsStore.getState().refreshContactsIfStale();
      interactionTask?.cancel?.();
      interactionTask = InteractionManager.runAfterInteractions(() => {
        if (cancelled) return;
        void preloadAppDataOnForeground(user.uid!).catch(() => {});
      });
    };

    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        runForegroundReconnect();
      }, Platform.OS === 'android' ? 350 : 200);
    });

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      interactionTask?.cancel?.();
      sub.remove();
    };
  }, [user?.uid, setupComplete]);

  // 1.155 Background — drop cold message caches + image RAM (disk cache kept).
  useEffect(() => {
    if (Platform.OS === 'web' || !user?.uid) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'background') return;
      useChatStore.getState().trimMemoryFootprint();
      releaseImageMemoryCache();
    });
    return () => sub.remove();
  }, [user?.uid]);

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
              t('calls.reliabilityTitle'),
              t('calls.reliabilityBody'),
              [
                { text: t('calls.reliabilityNotNow'), style: 'cancel' },
                {
                  text: t('calls.reliabilityOpenSettings'),
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
  }, [user?.uid, setupComplete, t]);

  // Android: register answer/decline listeners as soon as user is signed in (do not wait setupComplete).
  useEffect(() => {
    if (Platform.OS !== 'android' || !user?.uid) return;

    const callEmitter = new NativeEventEmitter(NativeModules.IncomingCallModule);
    const answerSub = callEmitter.addListener(
      'onAnswerCall',
      async (payload: { callId?: string; callType?: string }) => {
        if (!payload?.callId) return;
        console.log('ACCEPT_JS_EVENT_RECEIVED', {
          callId: payload.callId,
          callType: payload.callType,
          ts: Date.now(),
        });
        const ct = payload.callType === 'video' ? 'video' : 'audio';
        void handleAnswerCallNavigation(router, {
          callId: payload.callId,
          callType: ct,
        });
      },
    );
    const declineSub = callEmitter.addListener(
      'onDeclineCall',
      async (payload: { callId?: string }) => {
        if (!payload?.callId) return;
        await callManagerActionsRef.rejectCall(payload.callId);
      },
    );

    const bridge = NativeModules.IncomingCallBridge;
    let bridgeAcceptSub: { remove: () => void } | undefined;
    let bridgeDeclineSub: { remove: () => void } | undefined;
    if (bridge) {
      const bridgeEmitter = new NativeEventEmitter(bridge);
      bridgeAcceptSub = bridgeEmitter.addListener(
        'IncomingCallAccepted',
        async (payload: { chatId?: string; callType?: string }) => {
          if (!payload?.chatId) return;
          const callType = payload.callType === 'video' ? 'video' : 'audio';
          void handleAnswerCallNavigation(router, {
            callId: payload.chatId,
            callType,
          });
        },
      );
      bridgeDeclineSub = bridgeEmitter.addListener(
        'IncomingCallDeclined',
        async (payload: { chatId?: string }) => {
          if (payload?.chatId) await callManagerActionsRef.rejectCall(payload.chatId);
        },
      );
    }

    return () => {
      answerSub.remove();
      declineSub.remove();
      bridgeAcceptSub?.remove();
      bridgeDeclineSub?.remove();
    };
  }, [user?.uid, router]);

  // Android: MainActivity ANSWER_CALL / gyw://call intent — navigate without waiting Firestore user setup.
  useEffect(() => {
    if (Platform.OS !== 'android' || !user?.uid) return;

    const mod = NativeModules.IncomingCallModule as {
      getInitialCallIntent?: () => Promise<{
        callId: string;
        callType: 'audio' | 'video';
        callerUid?: string;
        callerName?: string;
        callerPhotoURL?: string;
        answered?: boolean;
        autoAccept?: boolean;
      } | null>;
    } | undefined;

    if (!mod?.getInitialCallIntent) return;

    const handledAcceptIntents = new Set<string>();

    const processAcceptIntent = async (source: string) => {
      try {
        const initial = await mod.getInitialCallIntent();
        if (!initial?.callId) return;

        const shouldAutoAccept = initial.autoAccept === true || initial.answered === true;
        if (!shouldAutoAccept) return;

        if (handledAcceptIntents.has(initial.callId)) return;
        if (useCallSessionStore.getState().activeSessionCallId === initial.callId) return;
        handledAcceptIntents.add(initial.callId);
        setTimeout(() => handledAcceptIntents.delete(initial.callId), 60_000);

        console.log('ACCEPT_GET_INITIAL_INTENT', {
          callId: initial.callId,
          callType: initial.callType,
          answered: initial.answered,
          autoAccept: initial.autoAccept,
          source,
          ts: Date.now(),
        });

        const callId = initial.callId;
        const callType = initial.callType === 'video' ? 'video' : 'audio';

        const { markCallAccepted } = await import('@/lib/call/incomingCallGuard');
        const { useCallManagerStore } = await import('@/store/callManagerStore');

        markCallAccepted(callId, 'getInitialCallIntent_autoAccept');
        useCallManagerStore.getState().markCalleeAnswered(callId);

        useCallStore.getState().setIncomingCall({
          callId,
          callType,
          status: 'accepted',
          callerId: initial.callerUid ?? '',
          callerName: initial.callerName ?? 'Incoming call',
          callerAvatar: initial.callerPhotoURL,
          timestamp: Date.now(),
        });

        useCallManagerStore.getState().setActiveCallId(callId);
        void handleAnswerCallNavigation(router, { callId, callType });
      } catch (e) {
        if (__DEV__) console.warn('[HomeLayout] getInitialCallIntent failed', e);
      }
    };

    void processAcceptIntent('mount');
  }, [user?.uid, router]);

  // Incoming call state: useCallManager (CallManagerHost) — single Firestore doc listener.

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

    const writePresence = (isActive: boolean) => {
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
    };

    const handleAppStateChange = (nextState: AppStateStatus) => {
      const wasActive = appStateRef.current === 'active';
      const isActive = nextState === 'active';
      appStateRef.current = nextState;

      if (wasActive === isActive) return;

      if (!isActive) {
        if (foregroundPresenceTimerRef.current) {
          clearTimeout(foregroundPresenceTimerRef.current);
          foregroundPresenceTimerRef.current = null;
        }
        writePresence(false);
        return;
      }

      if (foregroundPresenceTimerRef.current) {
        clearTimeout(foregroundPresenceTimerRef.current);
      }
      foregroundPresenceTimerRef.current = setTimeout(() => {
        foregroundPresenceTimerRef.current = null;
        writePresence(true);
      }, 220);
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
      if (foregroundPresenceTimerRef.current) {
        clearTimeout(foregroundPresenceTimerRef.current);
        foregroundPresenceTimerRef.current = null;
      }
    };
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
            animation: 'slide_from_right',
            animationDuration: 200,
          }}
        />
        <Stack.Screen
          name="user-profile"
          options={{
            headerShown: true,
            animation: 'slide_from_right',
            animationDuration: 220,
          }}
        />
        <Stack.Screen
          name="group-info/[chatId]"
          options={{
            headerShown: true,
            animation: 'slide_from_right',
            animationDuration: 220,
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


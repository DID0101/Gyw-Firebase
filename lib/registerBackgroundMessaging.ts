/**
 * FCM background handler — must register before AppRegistry / React mounts.
 * `setBackgroundMessageHandler` is registered at **module load** (top level) per RN Firebase requirements.
 *
 * Expo Go: not supported. Use a dev/production native build.
 */
import { AppState, type AppStateStatus, Platform } from 'react-native';

import { classifyFcmDelivery, logFcmAndroidDeviceContext, serializeFcmRemoteMessage } from '@/lib/fcmDiagnostics';
import { nativeAppendDebugTrace } from '@/lib/nativeCallService';

console.error('📦 BACKGROUND MODULE LOADED — handler will be registered');

/**
 * Pending call written by GywFcmService when JS never ran (e.g. TECNO HiOS).
 *
 * IMPORTANT: this function is called when the app comes to the foreground — either because
 * the user tapped the GywCallService notification (cold start / background), or because
 * AppState changed to 'active'. In all these cases the GywCallService already showed the
 * system notification. We must NOT call presentIncomingCallInvite() again (that would start
 * a second CallKeep sheet / Notifee FGS on top of the running app). Instead we navigate
 * directly to the in-app call screen.
 */
async function consumeNativePendingCallIfRecent(source: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const { nativeGetPendingCall, nativeClearPendingCall } =
      require('@/lib/nativeCallService') as typeof import('@/lib/nativeCallService');
    const pending = await nativeGetPendingCall();
    if (!pending?.callId) return;
    const ageMs = Date.now() - parseInt(pending.receivedAt ?? '0', 10);
    console.error(`🔔 NATIVE PENDING CALL FOUND [${source}]`, { ...pending, ageMs });
    if (ageMs < 55_000) {
      // Navigate directly — GywCallService already showed the system notification.
      // Calling presentIncomingCallInvite here would spawn a duplicate incoming-call UI.
      const { navigateToIncomingCallScreen } =
        require('@/lib/incomingCallNavigation') as typeof import('@/lib/incomingCallNavigation');
      nativeClearPendingCall(); // clear before navigate to prevent double-navigation on AppState churn
      navigateToIncomingCallScreen(pending.callId, { autoAccept: false });
    } else {
      console.error(`🔔 NATIVE PENDING CALL EXPIRED [${source}]`, { ageMs });
      nativeClearPendingCall();
    }
  } catch (e) {
    console.error(`[registerBackgroundMessaging] nativeGetPendingCall [${source}]`, e);
  }
}

if (Platform.OS !== 'web') {
  try {
    const messaging = require('@react-native-firebase/messaging').default;
    const incoming = require('@/lib/incomingCallInvite') as typeof import('@/lib/incomingCallInvite');

    console.error('📦 REGISTERING setBackgroundMessageHandler NOW');

    messaging().setBackgroundMessageHandler(
      async (remoteMessage: { data?: Record<string, string>; notification?: unknown }) => {
        if (Platform.OS === 'android') {
          nativeAppendDebugTrace('JS STEP A: Background Handler Triggered');
          nativeAppendDebugTrace(
            'JS STEP B: Data Payload Content: ' + JSON.stringify(remoteMessage?.data ?? {})
          );
        }
        const rm = remoteMessage as unknown as Record<string, unknown>;
        console.error('🚨🚨🚨 FCM BACKGROUND HANDLER FIRED 🚨🚨🚨', {
          hasData: !!remoteMessage?.data,
          type: remoteMessage?.data?.type,
          keys: Object.keys(remoteMessage?.data ?? {}),
        });
        console.error('📩 RAW FCM BACKGROUND received', serializeFcmRemoteMessage(rm));
        console.error('[FCM] delivery class:', classifyFcmDelivery(rm));

        if (rm.notification != null) {
          console.error(
            '[FCM] notification+data call invite (OEM may show tray; JS handler running — continuing)'
          );
        }

        console.error('🔥 STEP 1: FCM BACKGROUND HANDLER — data keys', JSON.stringify(remoteMessage?.data ?? {}));

        const rec = incoming.fcmDataToStringRecord(remoteMessage.data);
        if (rec.traceId) {
          console.error('📦 MESSAGE SOURCE TRACE', rec.traceId, 'path=background-handler');
        }
        if (!rec.type) {
          console.error('STEP 2: HANDLER END — no data.type, ignoring');
          return;
        }

        console.error('STEP 2: HANDLER START — type', rec.type);
        if (Platform.OS === 'android') {
          nativeAppendDebugTrace('JS STEP C: Calling incomingCallInvite logic (handleFcmCallDataMessage)');
        }
        await incoming.handleFcmCallDataMessage(rec, 'background');
        if (Platform.OS === 'android') {
          nativeAppendDebugTrace('JS STEP D: handleFcmCallDataMessage returned');
        }
        console.error('STEP 6: HANDLER DONE — type', rec.type);
      }
    );
  } catch (e) {
    console.error('[FCM] setBackgroundMessageHandler failed:', e);
  }
}

export function registerBackgroundMessaging(): void {
  if (Platform.OS === 'web') return;

  try {
    const messaging = require('@react-native-firebase/messaging').default;
    const {
      registerNotifeeIncomingCallBackgroundHandler,
      registerNotifeeIncomingCallForegroundService,
      registerNotifeeIncomingCallPressHandler,
      tryHandleNotificationOpenIncomingCall,
    } = require('@/lib/incomingCallInvite') as typeof import('@/lib/incomingCallInvite');

    if (Platform.OS === 'android') {
      logFcmAndroidDeviceContext();
    }

    void messaging()
      .getToken()
      .then((t: string) => {
        console.error('🔑 CURRENT FCM TOKEN (registerBackgroundMessaging bootstrap):', t);
      })
      .catch((e: unknown) => {
        console.error('🔑 CURRENT FCM TOKEN (bootstrap) failed:', e);
      });

    try {
      const firebaseApp = require('@react-native-firebase/app').default;
      const n = firebaseApp.apps?.length ?? -1;
      console.error('[FCM] Firebase app instances (expect 1)', n);
      if (n > 1) {
        console.error('[FCM] WARNING: multiple Firebase apps — ensure messaging uses default');
      }
    } catch (e) {
      console.error('[FCM] could not read Firebase app count', String(e));
    }

    if (Platform.OS === 'android') {
      registerNotifeeIncomingCallForegroundService();
    }
    registerNotifeeIncomingCallPressHandler();
    registerNotifeeIncomingCallBackgroundHandler();

    try {
      messaging().onTokenRefresh(() => {
        console.error('🔄 FCM onTokenRefresh fired — saving new token');
        void ensureFcmTokenSaved();
      });
    } catch (e) {
      console.error('[FCM] onTokenRefresh setup failed:', e);
    }

    messaging()
      .getInitialNotification()
      .then(async (remoteMessage: Record<string, unknown> | null) => {
        console.error('🔥 getInitialNotification CALLED — checking for missed call');
        if (remoteMessage) {
          console.error(
            '[FCM] getInitialNotification (app opened from quit via notification tap)',
            serializeFcmRemoteMessage(remoteMessage),
            '| class=',
            classifyFcmDelivery(remoteMessage)
          );
          console.error('🔥 getInitialNotification — possible missed call invite', {
            type: (remoteMessage.data as Record<string, string> | undefined)?.type,
            callId: (remoteMessage.data as Record<string, string> | undefined)?.callId,
          });
          await tryHandleNotificationOpenIncomingCall(remoteMessage, 'getInitialNotification');
        }
        await consumeNativePendingCallIfRecent('getInitialNotification');
      })
      .catch(() => {});

    messaging().onNotificationOpenedApp(async (remoteMessage: Record<string, unknown>) => {
      console.error('🔥 onNotificationOpenedApp CALLED — checking for missed call');
      console.error(
        '[FCM] onNotificationOpenedApp (background→foreground via notification)',
        serializeFcmRemoteMessage(remoteMessage),
        '| class=',
        classifyFcmDelivery(remoteMessage)
      );
      console.error('🔥 onNotificationOpenedApp — possible missed call invite', {
        type: (remoteMessage.data as Record<string, string> | undefined)?.type,
        callId: (remoteMessage.data as Record<string, string> | undefined)?.callId,
      });
      await tryHandleNotificationOpenIncomingCall(remoteMessage, 'onNotificationOpenedApp');
      await consumeNativePendingCallIfRecent('onNotificationOpenedApp');
    });

    if (Platform.OS === 'android') {
      AppState.addEventListener('change', (next: AppStateStatus) => {
        if (next === 'active') {
          void ensureFcmTokenSaved();
        }
      });
    }
  } catch (e) {
    console.error('[FCM] registerBackgroundMessaging failed:', e);
  }
}

/**
 * Save (or re-save) the current FCM token to Firestore under users/{uid}/fcmTokens.
 * Called on bootstrap, on every foreground resume, and on token rotation.
 * This is the recovery path after the Cloud Function cleanup deletes an invalid token —
 * the next time the app comes to the foreground a fresh valid token is written back.
 */
export async function ensureFcmTokenSaved(): Promise<void> {
  if (Platform.OS === 'web') return;
  let token: string | undefined;
  try {
    // FIX C: use @react-native-firebase/auth directly instead of getRnAuth().
    // getRnAuth() (from rnFirebase helper) reads the auth instance but returns null
    // currentUser if called before AuthProvider has mounted (common at bootstrap).
    // auth().currentUser from the RNFirebase module is the same singleton and also
    // returns null when called that early — but at least the error log is explicit.
    const auth = require('@react-native-firebase/auth').default;
    const currentUser = auth().currentUser;
    if (!currentUser?.uid) {
      console.error('❌ ensureFcmTokenSaved: no auth user');
      return;
    }
    const uid = currentUser.uid;

    const messaging =
      require('@react-native-firebase/messaging').default;
    token = await messaging().getToken();
    if (!token || token.length < 140) {
      console.error('❌ ensureFcmTokenSaved: invalid token len='
        + token?.length);
      return;
    }
    const firestore =
      require('@react-native-firebase/firestore').default;
    const docId = token.slice(-25).replace(/[^a-zA-Z0-9]/g, '_');
    await firestore()
      .collection('users')
      .doc(uid)
      .collection('fcmTokens')
      .doc(docId)
      .set({
        token,
        tokenLength: token.length,
        updatedAt: new Date().toISOString(),
        platform: 'android',
      });
    console.error('✅ ensureFcmTokenSaved len=' + token.length
      + ' uid=' + uid);
  } catch (e: unknown) {
    // FIX D: explicit message extraction so production logs show the real error.
    const msg = e instanceof Error ? e.message : String(e);
    console.error('❌ ensureFcmTokenSaved FATAL:', msg);
    // Fallback: write to the legacy top-level fcmToken field so callPush.ts can
    // still deliver calls via its legacy fallback branch (collectFcmTokensForUser
    // reads users/{uid}.fcmToken when the subcollection is empty).
    try {
      const auth = require('@react-native-firebase/auth').default;
      const uid = auth().currentUser?.uid;
      if (uid && token && token.length >= 140) {
        const db =
          require('@react-native-firebase/firestore').default();
        await db.collection('users').doc(uid).set(
          { fcmToken: token, fcmTokenUpdatedAt: new Date().toISOString() },
          { merge: true }
        );
        console.error('✅ FCM token saved to legacy field as fallback');
      }
    } catch (fallbackErr) {
      console.error('❌ fallback save also failed:', String(fallbackErr));
    }
  }
}

export async function testFirestoreWrite(): Promise<void> {
  try {
    const auth =
      require('@react-native-firebase/auth').default;
    const uid = auth().currentUser?.uid;
    console.error('🧪 testFirestoreWrite uid=' + uid);
    if (!uid) {
      console.error('❌ testFirestoreWrite: no uid');
      return;
    }
    const db =
      require('@react-native-firebase/firestore').default();
    await db
      .collection('users')
      .doc(uid)
      .collection('fcmTokens')
      .doc('test_doc')
      .set({ test: true, ts: new Date().toISOString() });
    console.error('✅ testFirestoreWrite: write succeeded');
  } catch (e) {
    console.error('❌ testFirestoreWrite FAILED:', String(e));
  }
}

/** Runtime permissions from root layout. Notifee press handler is registered in registerBackgroundMessaging(). */
export function bootstrapAndroidCallSupport(): void {
  if (Platform.OS !== 'android') return;
  try {
    const { requestAndroidCallKeepRuntimePermissions } = require('@/lib/incomingCallInvite') as typeof import(
      '@/lib/incomingCallInvite'
    );
    void requestAndroidCallKeepRuntimePermissions();

    // Request battery optimization exemption — critical for TECNO HiOS / MIUI / OxygenOS.
    // Without this the OS kills GywFcmService before it can start GywCallService when
    // the phone is sleeping, so calls are silent.
    const { nativeRequestBatteryOptimizationExemption, nativeRequestFullScreenIntentPermission } =
      require('@/lib/nativeCallService') as typeof import('@/lib/nativeCallService');
    nativeRequestBatteryOptimizationExemption();
    nativeRequestFullScreenIntentPermission(); // no-op below Android 14

    void consumeNativePendingCallIfRecent('bootstrap');

    void ensureFcmTokenSaved();

    // Read native FCM log to confirm GywFcmService fired
    void (async () => {
      try {
        const { nativeReadFcmLog, nativeReadDebugTrace } =
          require('@/lib/nativeCallService') as typeof import('@/lib/nativeCallService');
        const log = await nativeReadFcmLog();
        console.error('📋 NATIVE FCM LOG FILE:', log);
        const trace = await nativeReadDebugTrace();
        console.error('📋 GYW DEBUG TRACE (gyw_debug_trace.txt):', trace);
      } catch (e) {
        console.error('📋 NATIVE FCM LOG READ ERROR:', e);
      }
    })();
  } catch (e) {
    console.error('[FCM] bootstrapAndroidCallSupport failed:', e);
  }
}

registerBackgroundMessaging();

/**
 * Incoming call invite: Notifee (full-screen on Android) + CallKeep.
 * Used from FCM background handler and foreground onMessage (background handler does not run when app is in foreground).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform, type Permission } from 'react-native';

import { getIncomingCallNavigator, navigateToIncomingCallScreen } from '@/lib/incomingCallNavigation';
import {
  nativeAppendDebugTrace,
  nativeStartIncomingCall,
  nativeStopIncomingCall,
} from '@/lib/nativeCallService';
import { setPendingCallInvite, type PendingCallInvite } from '@/lib/pendingCallInviteStorage';
import { startIncomingCallVibration, stopIncomingCallVibration } from '@/lib/incomingCallVibration';

/** Bump when channel sound/importance must be recreated on devices (Android caches channel settings). */
const CHANNEL_ID = 'gyw_incoming_calls_v3';
/** Use console.error so logs show in release builds (RootLayout strips log/warn/info). */
function incomingCallPipelineLog(step: string, detail?: string): void {
  const msg = detail != null ? `[GYW INCOMING CALL] ${step} | ${detail}` : `[GYW INCOMING CALL] ${step}`;
  console.error(msg);
}

const CALLKEEP_UUID_PREFIX = 'gyw:callkeepUuid:';
/** Reverse map so we can end the native ConnectionService UI when the call is handled in-app. */
const CALLKEEP_CALLID_TO_UUID_KEY = 'gyw:callIdToCallKeepUuid:';

/** Skip Firestore reject when we programmatically dismiss CallKeep after status already updated. */
const programmaticEndCallUuids = new Set<string>();

let lastBackgroundSystemInvite: { callId: string; at: number } | null = null;

export type PresentIncomingCallInviteOptions = {
  /**
   * `foreground` = FCM onMessage only — in-app route, no system call sheet.
   * `background` = killed/background FCM — Notifee + CallKeep (do not trust AppState in headless JS).
   */
  mode: 'foreground' | 'background';
};

const CALLKEEP_CONFIG = {
  ios: {
    appName: 'GYW',
    supportsVideo: true,
  },
  android: {
    alertTitle: 'Permissions required',
    alertDescription: 'Allow phone access to show incoming calls on the lock screen.',
    cancelButton: 'Cancel',
    okButton: 'OK',
    imageName: 'ic_launcher',
    foregroundService: {
      channelId: 'gyw_call',
      channelName: 'Calls',
      notificationTitle: 'Call',
      notificationIcon: 'ic_launcher',
    },
  },
};

function uuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let callKeepListenersRegistered = false;

let notifeePressHandlerRegistered = false;
let notifeeBackgroundHandlerRegistered = false;
let notifeeForegroundServiceRegistered = false;

/** Stops Android Notifee foreground service started for incoming-call ringing (`asForegroundService`). */
export async function stopIncomingCallNotifeeForegroundService(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const notifee = require('@notifee/react-native').default;
    await notifee.stopForegroundService();
  } catch {
    /* no FGS active */
  }
}

/**
 * Required before `displayNotification({ android: { asForegroundService: true } })` on Android.
 * Registers a long-lived task; tear down with `stopIncomingCallNotifeeForegroundService`.
 */
export function registerNotifeeIncomingCallForegroundService(): void {
  if (notifeeForegroundServiceRegistered || Platform.OS !== 'android') return;
  notifeeForegroundServiceRegistered = true;
  try {
    const notifee = require('@notifee/react-native').default;
    notifee.registerForegroundService(async () => {
      await new Promise<void>(() => {
        /* stay alive until stopForegroundService() */
      });
    });
  } catch (e) {
    if (__DEV__) console.warn('[incomingCallInvite] Notifee registerForegroundService failed', e);
  }
}

/** Notification tap / deep link: show incoming call UI (user must tap Accept). */
export function openIncomingCallDeepLink(callId: string): void {
  nativeStopIncomingCall();
  void stopIncomingCallNotifeeForegroundService();
  navigateToIncomingCallScreen(callId, { autoAccept: false });
}

/** User tapped Answer on system CallKeep / ConnectionService UI — connect immediately. */
export function openIncomingCallAfterSystemAnswer(callId: string): void {
  nativeStopIncomingCall();
  void stopIncomingCallNotifeeForegroundService();
  navigateToIncomingCallScreen(callId, { autoAccept: true });
}

function registerCallKeepListenersOnce(): void {
  if (callKeepListenersRegistered || Platform.OS === 'web') return;
  callKeepListenersRegistered = true;
  try {
    const RNCallKeep = require('react-native-callkeep').default;
    const notifee = require('@notifee/react-native').default;

    RNCallKeep.addEventListener('answerCall', async ({ callUUID }: { callUUID: string }) => {
      try {
        stopIncomingCallVibration();
        const callId = await AsyncStorage.getItem(`${CALLKEEP_UUID_PREFIX}${callUUID}`);
        if (callId) {
          await notifee.cancelNotification(callId);
          await AsyncStorage.removeItem(`${CALLKEEP_UUID_PREFIX}${callUUID}`);
          await AsyncStorage.removeItem(`${CALLKEEP_CALLID_TO_UUID_KEY}${callId}`);
          openIncomingCallAfterSystemAnswer(callId);
        }
      } catch (e) {
        if (__DEV__) console.warn('[CallKeep] answerCall', e);
      }
    });

    RNCallKeep.addEventListener('endCall', async ({ callUUID }: { callUUID: string }) => {
      try {
        if (programmaticEndCallUuids.has(callUUID)) {
          programmaticEndCallUuids.delete(callUUID);
          return;
        }
        stopIncomingCallVibration();
        const callId = await AsyncStorage.getItem(`${CALLKEEP_UUID_PREFIX}${callUUID}`);
        if (callId) {
          await notifee.cancelNotification(callId);
          await stopIncomingCallNotifeeForegroundService();
          const { getCall, updateCallStatus, sendSignalingMessage } = await import('@/lib/services/callService');
          const { getRnAuth, hasRnFirebase } = await import('@/lib/rnFirebase');
          const uid = hasRnFirebase ? getRnAuth()?.currentUser?.uid : undefined;
          const call = await getCall(callId);
          if (call && call.status === 'ringing' && uid) {
            const other = call.callerId === uid ? call.receiverId : call.callerId;
            if (call.receiverId === uid) {
              await updateCallStatus(callId, 'rejected', undefined, call.chatId);
            } else if (call.callerId === uid) {
              await updateCallStatus(callId, 'missed', 0, call.chatId);
            }
            await sendSignalingMessage(callId, uid, other, 'hangup');
          }
          try {
            const { webRTCService } = await import('@/lib/services/webrtcService');
            webRTCService.cleanup(callId);
          } catch {
            /* ignore */
          }
          await AsyncStorage.removeItem(`${CALLKEEP_UUID_PREFIX}${callUUID}`);
          await AsyncStorage.removeItem(`${CALLKEEP_CALLID_TO_UUID_KEY}${callId}`);
        }
      } catch {
        /* ignore */
      }
    });
  } catch (e) {
    if (__DEV__) console.warn('[CallKeep] register listeners failed', e);
  }
}

/**
 * Request phone permissions CallKeep uses on API 30+ (READ_PHONE_NUMBERS).
 * Must run while an Activity exists — call from app UI on launch, not from headless FCM.
 */
export async function requestAndroidCallKeepRuntimePermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    const perms: Permission[] = [
      PermissionsAndroid.PERMISSIONS.CALL_PHONE,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
    ];
    if (api >= 30) {
      perms.push(PermissionsAndroid.PERMISSIONS.READ_PHONE_NUMBERS);
    }
    if (api >= 33) {
      perms.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
    incomingCallPipelineLog('Requesting Android CallKeep runtime permissions', perms.join(','));
    await PermissionsAndroid.requestMultiple(perms);
  } catch (e) {
    incomingCallPipelineLog('requestAndroidCallKeepRuntimePermissions failed', String(e));
  }
}

export async function ensureCallKeepSetup(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const RNCallKeep = require('react-native-callkeep').default;
    try {
      await RNCallKeep.setup(CALLKEEP_CONFIG);
    } catch (e) {
      // Killed/background: CallKeep's JS setup awaits permission UI — no Activity → promise rejects.
      // Native RNCallKeepModule.setup() still runs first inside that flow and registers PhoneAccount.
      incomingCallPipelineLog('CallKeep.setup() promise rejected (often OK headless)', String(e));
    }
    RNCallKeep.setAvailable(true);
    registerCallKeepListenersOnce();
    incomingCallPipelineLog('✅ CallKeep setup completed (listeners + setAvailable)');
    if (Platform.OS === 'android') {
      try {
        const ok = await RNCallKeep.hasPhoneAccount();
        incomingCallPipelineLog('CallKeep hasPhoneAccount (needs READ_PHONE_NUMBERS on API 30+)', String(ok));
      } catch (e) {
        incomingCallPipelineLog('CallKeep hasPhoneAccount check failed', String(e));
      }
    }
  } catch (err) {
    incomingCallPipelineLog('CallKeep ensureCallKeepSetup fatal', String(err));
  }
}

/** Dismiss native ConnectionService / CallKeep UI after accept/reject in-app (avoids duplicate UIs). */
export async function dismissCallKeepForCallId(callId: string): Promise<void> {
  if (Platform.OS === 'web' || !callId) return;
  try {
    const RNCallKeep = require('react-native-callkeep').default;
    const uuid = await AsyncStorage.getItem(`${CALLKEEP_CALLID_TO_UUID_KEY}${callId}`);
    if (!uuid) return;
    programmaticEndCallUuids.add(uuid);
    RNCallKeep.endCall(uuid);
    await AsyncStorage.multiRemove([`${CALLKEEP_UUID_PREFIX}${uuid}`, `${CALLKEEP_CALLID_TO_UUID_KEY}${callId}`]);
    setTimeout(() => programmaticEndCallUuids.delete(uuid), 800);
  } catch (e) {
    if (__DEV__) console.warn('[CallKeep] dismissCallKeepForCallId', e);
  }
}

export type CallInviteData = {
  type: string;
  callId: string;
  callerId: string;
  callType: string;
  callerName?: string;
};

const CALL_LIFECYCLE_FCM_TYPES = new Set([
  'call_accepted',
  'call_rejected',
  'call_ended',
  'call_timeout',
]);

/** Server sends `incoming_call`; legacy `call_invite` still accepted. */
export function isIncomingCallPushType(type: string | undefined): boolean {
  const t = String(type ?? '');
  return t === 'incoming_call' || t === 'call_invite';
}

export function isCallLifecycleFcmType(type: string | undefined): boolean {
  return CALL_LIFECYCLE_FCM_TYPES.has(String(type ?? ''));
}

function normalizeData(raw: Record<string, string | undefined>): CallInviteData | null {
  if (!raw.callId || !isIncomingCallPushType(raw.type)) return null;
  const type = String(raw.type);
  let callType = String(raw.callType ?? '');
  if (callType !== 'audio' && callType !== 'video') {
    callType = raw.hasVideo === 'false' ? 'audio' : 'video';
  }
  return {
    type,
    callId: String(raw.callId),
    callerId: String(raw.callerId ?? ''),
    callType,
    callerName: raw.callerName ? String(raw.callerName) : undefined,
  };
}

/**
 * Dismiss native incoming UI when server pushes call_accepted / rejected / ended / timeout (data-only FCM).
 */
export async function collapseIncomingCallUiFromRemotePush(callId: string): Promise<void> {
  if (!callId) return;
  if (Platform.OS === 'android') nativeStopIncomingCall();
  if (__DEV__) console.log('[FCM] lifecycle — dismiss incoming UI', callId);
  stopIncomingCallVibration();
  await stopIncomingCallNotifeeForegroundService();
  try {
    const notifee = require('@notifee/react-native').default;
    await notifee.cancelNotification(callId);
  } catch {
    /* ignore */
  }
  await dismissCallKeepForCallId(callId);
}

/** Route FCM data payload: incoming → full UX; lifecycle → dismiss only. */
export async function handleFcmCallDataMessage(
  raw: Record<string, string | undefined>,
  mode: 'foreground' | 'background'
): Promise<void> {
  if (Platform.OS === 'android') {
    nativeAppendDebugTrace(
      `UI STEP X: Incoming Call Function Started (handleFcmCallDataMessage) mode=${mode} type=${String(raw.type ?? '')}`
    );
  }
  const traceId = raw.traceId;
  if (traceId) {
    console.error('📦 MESSAGE SOURCE TRACE', traceId, `mode=${mode}`);
  }
  const t = String(raw.type ?? '');
  if (!t) return;
  incomingCallPipelineLog('STEP 3: CALL ROUTE', `mode=${mode} type=${t}`);
  if (isIncomingCallPushType(t)) {
    await presentIncomingCallInvite(raw, { mode });
    return;
  }
  if (isCallLifecycleFcmType(t) && raw.callId) {
    await collapseIncomingCallUiFromRemotePush(String(raw.callId));
  }
}

/**
 * When the user opens the app from an FCM notification (cold start or background), headless
 * `setBackgroundMessageHandler` may not have run. If the RemoteMessage includes a `notification`
 * payload and `data.type` is an incoming-call, show the same system incoming UX.
 */
export async function tryHandleNotificationOpenIncomingCall(
  remoteMessage: Record<string, unknown> | null | undefined,
  source: 'getInitialNotification' | 'onNotificationOpenedApp'
): Promise<void> {
  if (Platform.OS === 'web' || !remoteMessage) {
    console.error('[FALLBACK] tryHandleNotificationOpenIncomingCall: null remoteMessage, source=', source);
    return;
  }

  console.error('[FALLBACK] tryHandleNotificationOpenIncomingCall ENTRY', {
    source,
    hasNotification: remoteMessage.notification != null,
    hasData: remoteMessage.data != null,
    dataKeys: remoteMessage.data != null ? Object.keys(remoteMessage.data as object) : [],
  });

  const rec = fcmDataToStringRecord(
    remoteMessage.data as Record<string, string | object | undefined>
  );

  console.error('[FALLBACK] rec extracted', {
    source,
    type: rec.type,
    callId: rec.callId,
    callerId: rec.callerId,
  });

  if (!isIncomingCallPushType(rec.type)) {
    console.error('[FALLBACK] not an incoming call type, skipping', { source, type: rec.type });
    return;
  }

  if (!rec.callId) {
    console.error('[FALLBACK] no callId in data, skipping', { source });
    return;
  }

  console.error('FALLBACK CALL UI TRIGGERED', {
    reason: 'notification-open-fcm',
    source,
    callId: rec.callId,
  });

  await handleFcmCallDataMessage(rec, 'background');
}

/**
 * Show incoming call UX. Use explicit `mode` — do not rely on AppState in FCM headless tasks (it often lies).
 * - foreground: in-app route only (FCM `onMessage`).
 * - background: Notifee + CallKeep `displayIncomingCall` (FCM background handler, app killed/background).
 */
export async function presentIncomingCallInvite(
  raw: Record<string, string | undefined>,
  options?: PresentIncomingCallInviteOptions
): Promise<void> {
  if (Platform.OS === 'web') return;

  const data = normalizeData(raw);
  if (!data) return;

  if (Platform.OS === 'android') {
    nativeAppendDebugTrace(
      `UI STEP X2: presentIncomingCallInvite started callId=${data.callId} mode=${options?.mode ?? 'background'}`
    );
  }

  const mode: 'foreground' | 'background' = options?.mode ?? 'background';

  const pending: PendingCallInvite = {
    callId: data.callId,
    callerId: data.callerId,
    callType: data.callType,
    receivedAt: Date.now(),
  };
  await setPendingCallInvite(pending);

  if (mode === 'foreground') {
    await ensureCallKeepSetup();

    const navigatorReady = getIncomingCallNavigator() != null;

    console.error('[FCM FOREGROUND] presentIncomingCallInvite', {
      callId: data.callId,
      navigatorReady,
    });

    if (navigatorReady) {
      console.error('[FCM FOREGROUND] navigator ready — navigating directly');
      navigateToIncomingCallScreen(data.callId, { autoAccept: false });
      return;
    }

    console.error(
      '[FCM FOREGROUND] navigator NOT ready — falling through to background system UI',
      { callId: data.callId }
    );
  }

  const now = Date.now();
  if (
    lastBackgroundSystemInvite &&
    lastBackgroundSystemInvite.callId === data.callId &&
    now - lastBackgroundSystemInvite.at < 4000
  ) {
    if (__DEV__) console.log('[incomingCallInvite] skip duplicate system UI', data.callId);
    return;
  }
  lastBackgroundSystemInvite = { callId: data.callId, at: now };

  incomingCallPipelineLog('STEP 3b: CALL INVITE (background system UI)', data.callId);
  await ensureCallKeepSetup();

  const runNotifeeIncomingDisplay = async (): Promise<void> => {
    if (Platform.OS === 'android') {
      nativeAppendDebugTrace('UI STEP Y: Attempting to play Sound (Notifee displayNotification)');
    }
    try {
      const notifee = require('@notifee/react-native').default;
      const { AndroidImportance, AndroidCategory, AndroidVisibility, AndroidForegroundServiceType } = require('@notifee/react-native');

      if (Platform.OS === 'android') {
        await notifee.createChannel({
          id: CHANNEL_ID,
          name: 'Incoming calls',
          importance: AndroidImportance.HIGH,
          sound: 'default',
          vibration: true,
          bypassDnd: true,
        });
      }

      const callerLabel = data.callerName || data.callerId || 'Unknown';
      const title = data.callerName ? `${data.callerName}` : 'Incoming call';
      const subtitle = data.callType === 'video' ? 'Video call' : 'Audio call';

      await notifee.displayNotification({
        id: data.callId,
        title,
        subtitle,
        body: `${callerLabel} — tap to answer`,
        data: {
          type: 'incoming_call',
          callId: data.callId,
          callerId: data.callerId,
          callType: data.callType,
          hasVideo: data.callType === 'video' ? 'true' : 'false',
          ...(data.callerName && { callerName: data.callerName }),
        },
        android: {
          channelId: CHANNEL_ID,
          category: AndroidCategory.CALL,
          importance: AndroidImportance.HIGH,
          ongoing: true,
          asForegroundService: Platform.OS === 'android',
          // PHONE_CALL type requires TelecomManager ConnectionService — we don't have one.
          // MICROPHONE is correct for a VoIP app that owns its own audio session.
          foregroundServiceTypes:
            Platform.OS === 'android' ? [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE] : undefined,
          autoCancel: false,
          visibility: AndroidVisibility.PUBLIC,
          showTimestamp: true,
          lightUpScreen: true,
          sound: 'default',
          loopSound: true,
          pressAction: {
            id: 'default',
            launchActivity: 'default',
          },
          fullScreenAction: {
            id: 'default',
            launchActivity: 'default',
          },
        },
        ios: {
          sound: 'default',
          foregroundPresentationOptions: {
            alert: true,
            badge: true,
            sound: true,
          },
        },
      });
      if (Platform.OS === 'android') {
        nativeAppendDebugTrace('UI STEP Y OK: Notifee displayNotification finished');
      }
    } catch (e) {
      if (Platform.OS === 'android') {
        nativeAppendDebugTrace('UI STEP Y FAIL: ' + String(e));
      }
      if (__DEV__) console.warn('[incomingCallInvite] notifee display failed', e);
    }
  };

  const runCallKeepDisplay = async (): Promise<void> => {
    try {
      const RNCallKeep = require('react-native-callkeep').default;
      const uuid = uuidV4();
      const handle = data.callerName || data.callerId || 'Unknown';
      const hasVideo = data.callType === 'video';
      await AsyncStorage.setItem(`${CALLKEEP_UUID_PREFIX}${uuid}`, data.callId);
      await AsyncStorage.setItem(`${CALLKEEP_CALLID_TO_UUID_KEY}${data.callId}`, uuid);
      incomingCallPipelineLog('📞 STEP 4: CALLKEEP DISPLAY TRIGGER', `callId=${data.callId} uuid=${uuid}`);
      RNCallKeep.displayIncomingCall(uuid, handle, handle, 'generic', hasVideo);
      incomingCallPipelineLog('STEP 4b: CallKeep displayIncomingCall returned');
    } catch (e) {
      const err = String(e);
      incomingCallPipelineLog('STEP 4 ERROR: CallKeep displayIncomingCall', err);
      console.error('FALLBACK CALL UI TRIGGERED', { reason: 'CallKeep-display-failed', callId: data.callId, error: err });
    }
  };

  // Android: CallKeep (ConnectionService UI) first, then Notifee ringtone notification + vibration.
  // nativeStartIncomingCall() is intentionally NOT called here — GywFcmService already started
  // GywCallService (native) before this JS handler ran. Calling it again would double-start the
  // service and show duplicate notifications.
  // iOS: keep prior ordering (Notifee then CallKit).
  if (Platform.OS === 'android') {
    await runCallKeepDisplay();
    nativeAppendDebugTrace('UI STEP Z: Attempting to vibrate');
    try {
      incomingCallPipelineLog('📳 STEP 5: START VIBRATION (explicit, not only Notifee channel)');
      startIncomingCallVibration();
    } catch (e) {
      nativeAppendDebugTrace('UI STEP Z FAIL: ' + String(e));
      incomingCallPipelineLog('STEP 5 ERROR: vibration', String(e));
    }
    await runNotifeeIncomingDisplay();
  } else {
    await runNotifeeIncomingDisplay();
    await runCallKeepDisplay();
  }
}

/** FCM data values are strings; normalize for `presentIncomingCallInvite`. */
export function fcmDataToStringRecord(
  d: Record<string, string | object | undefined> | undefined
): Record<string, string | undefined> {
  if (!d) return {};
  const out: Record<string, string | undefined> = {};
  for (const k of Object.keys(d)) {
    const v = d[k];
    out[k] = v == null ? undefined : typeof v === 'string' ? v : String(v);
  }
  return out;
}

/** Foreground / resumed app: Notifee notification tap → in-app call route. */
export function registerNotifeeIncomingCallPressHandler(): void {
  if (notifeePressHandlerRegistered || Platform.OS === 'web') return;
  notifeePressHandlerRegistered = true;
  try {
    const notifee = require('@notifee/react-native').default;
    notifee.onForegroundEvent(({ type, detail }: { type: number; detail: { notification?: { data?: Record<string, unknown> } } }) => {
      if (type !== notifee.EventType.PRESS && type !== notifee.EventType.ACTION_PRESS) return;
      const raw = detail.notification?.data;
      if (!raw || !isIncomingCallPushType(String(raw.type)) || !raw.callId) return;
      openIncomingCallDeepLink(String(raw.callId));
    });
  } catch (e) {
    if (__DEV__) console.warn('[incomingCallInvite] Notifee press handler failed', e);
  }
}

/**
 * Background / headless: user tapped incoming-call notification while app was not in foreground.
 * Register early (same entry as FCM background handler).
 */
export function registerNotifeeIncomingCallBackgroundHandler(): void {
  if (notifeeBackgroundHandlerRegistered || Platform.OS === 'web') return;
  notifeeBackgroundHandlerRegistered = true;
  try {
    const notifee = require('@notifee/react-native').default;
    notifee.onBackgroundEvent(async ({ type, detail }: { type: number; detail: { notification?: { data?: Record<string, unknown> } } }) => {
      if (type !== notifee.EventType.PRESS && type !== notifee.EventType.ACTION_PRESS) return;
      const raw = detail.notification?.data;
      if (!raw || !isIncomingCallPushType(String(raw.type)) || !raw.callId) return;
      openIncomingCallDeepLink(String(raw.callId));
    });
  } catch (e) {
    if (__DEV__) console.warn('[incomingCallInvite] Notifee background handler failed', e);
  }
}

/**
 * Foreground FCM: `setBackgroundMessageHandler` does not run while the app is active.
 * Returns an unsubscribe function (no-op on web).
 */
export function subscribeForegroundFcmCallInvites(): () => void {
  if (Platform.OS === 'web') return () => {};
  try {
    const messaging = require('@react-native-firebase/messaging').default;
    return messaging().onMessage(async (remoteMessage: { data?: Record<string, string | object | undefined> }) => {
      console.error('[FCM FOREGROUND] onMessage fired', {
        type: (remoteMessage.data as Record<string, string> | undefined)?.type,
        callId: (remoteMessage.data as Record<string, string> | undefined)?.callId,
      });
      try {
        const { classifyFcmDelivery, serializeFcmRemoteMessage } = require('@/lib/fcmDiagnostics') as typeof import(
          '@/lib/fcmDiagnostics'
        );
        console.error('[FCM FOREGROUND] 📩 RAW FCM:', serializeFcmRemoteMessage(remoteMessage as Record<string, unknown>));
        console.error('[FCM FOREGROUND] delivery class:', classifyFcmDelivery(remoteMessage as Record<string, unknown>));
      } catch {
        /* ignore diag */
      }
      const rec = fcmDataToStringRecord(remoteMessage.data);
      if (rec.traceId) {
        console.error('📦 MESSAGE SOURCE TRACE', rec.traceId, 'path=foreground-onMessage');
      }
      if (!rec.type) {
        console.error('[FCM FOREGROUND] no data.type — same message in background would stop at STEP 2');
        return;
      }
      await handleFcmCallDataMessage(rec, 'foreground');
    });
  } catch (e) {
    if (__DEV__) console.warn('[incomingCallInvite] FCM onMessage subscribe failed', e);
    return () => {};
  }
}

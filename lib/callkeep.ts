/**
 * lib/callkeep.ts
 *
 * JS bridge to react-native-callkeep (iOS CallKit / Android self-managed
 * TelecomManager via ConnectionService).
 *
 * Platform strategy
 * ─────────────────
 *   iOS    — RNCallKeep owns CXProvider / CXCallController.
 *            displayIncomingCall() shows the system lock-screen call UI.
 *            Audio session activation is forwarded to InCallManager.
 *
 *   Android — CallConnectionService.kt + GywFirebaseMessagingService.kt
 *            own TelecomManager directly.  displayIncomingCall() is a
 *            no-op here — the native layer handles everything.
 *            RNCallKeep is still initialised on Android to provide the JS
 *            event bus (answerCall / endCall from the Telecom Connection).
 *
 * Lifecycle
 * ─────────
 *   await setupCallKeep(router)  — called once after sign-in (useCallManager)
 *   teardownCallKeep()           — called on sign-out
 *   Both are idempotent.
 *
 * @module callkeep
 */

import { Platform } from 'react-native';
import type { Router } from 'expo-router';
import { useCallManagerStore } from '@/store/callManagerStore';

// Lazy-load so the web / Expo-Go bundler never pulls in the native module.
let RNCallKeep: any = null;

if (Platform.OS !== 'web') {
  try {
    RNCallKeep = require('react-native-callkeep').default;
  } catch (_) {
    if (__DEV__) console.warn('[callkeep] react-native-callkeep not available');
  }
}

// ── Setup options ─────────────────────────────────────────────────────────────

/** iOS CallKit CXProvider configuration. Max 1 call group × 1 call = no merging. */
const IOS_OPTIONS = {
  appName:                    'Gyw',
  supportsVideo:              true,
  maximumCallGroups:          '1',
  maximumCallsPerCallGroup:   '1',
  ringtoneSound:              undefined as string | undefined, // system default
  imageName:                  'AppIcon',
  includesCallsInRecents:     false,
} as const;

/**
 * Android self-managed TelecomManager configuration.
 * selfManaged: true aligns with CallConnectionService.kt's
 * CAPABILITY_SELF_MANAGED PhoneAccount.
 */
const ANDROID_OPTIONS = {
  alertTitle:            'Phone account permissions',
  alertDescription:      'Allow Gyw to manage phone calls',
  cancelButton:          'Cancel',
  okButton:              'Allow',
  additionalPermissions: [] as string[],
  foregroundService: {
    channelId:         'com.gyw1.chat.call',
    channelName:       'Ongoing Call',
    notificationTitle: 'Call in progress',
    notificationIcon:  'ic_launcher',
  },
  selfManaged: true,
} as const;

// ── Module-level state ────────────────────────────────────────────────────────

let _isSetUp  = false;
let _router:  Router | null = null;

// ── Exported callback types ───────────────────────────────────────────────────

/** Called when CallKit / Telecom signals an answer event. */
export type AnswerCallHandler = (callId: string) => void;
/** Called when CallKit / Telecom signals an end/dismiss event. */
export type EndCallHandler    = (callId: string) => void;

let _onAnswer: AnswerCallHandler | null = null;
let _onEnd:    EndCallHandler    | null = null;

// ── Internal event handlers ───────────────────────────────────────────────────

function handleAnswerCall({ callUUID }: { callUUID: string }): void {
  if (__DEV__) console.log('[callkeep] answerCall', callUUID);
  useCallManagerStore.getState().onCallAnswered(callUUID);
  _onAnswer?.(callUUID);

  // Navigate to the call screen with accept=1 so WebRTC starts immediately.
  if (_router) {
    try {
      _router.push(`/(home)/call/${callUUID}?accept=1` as any);
    } catch (_) {}
  }
}

function handleEndCall({ callUUID }: { callUUID: string }): void {
  if (__DEV__) console.log('[callkeep] endCall', callUUID);
  useCallManagerStore.getState().onCallEnded(callUUID);
  _onEnd?.(callUUID);
}

/**
 * CallKit is asking us to start an outgoing call (e.g. from Recents / Siri).
 * The actual WebRTC offer is initiated by the call screen itself.
 */
function handleDidReceiveStartCallAction({
  callUUID,
  handle,
  name,
}: {
  callUUID: string;
  handle:   string;
  name?:    string;
}): void {
  if (__DEV__) console.log('[callkeep] didReceiveStartCallAction', { callUUID, handle, name });
}

/**
 * User pressed a DTMF digit on the in-call keypad.
 * Pass to the active RTC data-channel if needed.
 */
function handleDidPerformDTMFAction({
  callUUID,
  digits,
}: {
  callUUID: string;
  digits:   string;
}): void {
  if (__DEV__) console.log('[callkeep] DTMF', { callUUID, digits });
}

/** User tapped Hold. */
function handleDidToggleHoldCallAction({
  callUUID,
  hold,
}: {
  callUUID: string;
  hold:     boolean;
}): void {
  if (__DEV__) console.log('[callkeep] hold', { callUUID, hold });
}

/**
 * CallKit activated the audio session.
 * Start InCallManager so audio routing (speaker / earpiece / Bluetooth) works.
 */
function handleDidActivateAudioSession(): void {
  if (__DEV__) console.log('[callkeep] audio session activated');
  try {
    const InCallManager = require('react-native-incall-manager').default;
    InCallManager.start({ media: 'audio' });
    InCallManager.setSpeakerphoneOn(false);
  } catch (_) {}
}

/**
 * Android self-managed: TelecomManager asks JS to show its own incoming-call UI.
 * Our native GywIncomingCallService already handles this; JS is a fallback.
 */
function handleShowIncomingCallUi({
  callUUID,
  handle,
  name,
}: {
  callUUID: string;
  handle:   string;
  name:     string;
}): void {
  if (__DEV__) console.log('[callkeep] showIncomingCallUi', { callUUID, handle, name });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise RNCallKeep and register all event listeners.
 *
 * Idempotent — safe to call multiple times; subsequent calls are no-ops
 * unless the router reference changes.
 *
 * @param router      - Expo Router instance for programmatic navigation.
 * @param onAnswerCall - Optional callback after CallKit answers.
 * @param onEndCall    - Optional callback after CallKit ends.
 */
export async function setupCallKeep(
  router:       Router,
  onAnswerCall?: AnswerCallHandler,
  onEndCall?:    EndCallHandler,
): Promise<void> {
  if (Platform.OS === 'web' || !RNCallKeep) return;

  _router   = router;
  _onAnswer = onAnswerCall ?? null;
  _onEnd    = onEndCall    ?? null;

  if (_isSetUp) return; // listeners already attached

  try {
    await RNCallKeep.setup({ ios: IOS_OPTIONS, android: ANDROID_OPTIONS });

    RNCallKeep.addEventListener('answerCall',                handleAnswerCall);
    RNCallKeep.addEventListener('endCall',                   handleEndCall);
    RNCallKeep.addEventListener('didReceiveStartCallAction', handleDidReceiveStartCallAction);
    RNCallKeep.addEventListener('didPerformDTMFAction',      handleDidPerformDTMFAction);
    RNCallKeep.addEventListener('didToggleHoldCallAction',   handleDidToggleHoldCallAction);
    RNCallKeep.addEventListener('didActivateAudioSession',   handleDidActivateAudioSession);

    if (Platform.OS === 'android') {
      RNCallKeep.addEventListener('showIncomingCallUi', handleShowIncomingCallUi);
    }

    if (Platform.OS === 'ios') {
      // Signal to CallKit that the app is ready to receive calls.
      RNCallKeep.setAvailable(true);
    }

    _isSetUp = true;
    if (__DEV__) console.log('[callkeep] setup complete');
  } catch (err) {
    if (__DEV__) console.error('[callkeep] setup failed:', err);
  }
}

/**
 * Remove all CallKeep event listeners.
 * Call this when the user signs out to prevent stale listeners.
 */
export function teardownCallKeep(): void {
  if (!RNCallKeep || !_isSetUp) return;

  const events = [
    'answerCall',
    'endCall',
    'didReceiveStartCallAction',
    'didPerformDTMFAction',
    'didToggleHoldCallAction',
    'didActivateAudioSession',
  ] as const;

  for (const ev of events) {
    try { RNCallKeep.removeEventListener(ev); } catch (_) {}
  }

  if (Platform.OS === 'android') {
    try { RNCallKeep.removeEventListener('showIncomingCallUi'); } catch (_) {}
  }

  _router   = null;
  _onAnswer = null;
  _onEnd    = null;
  _isSetUp  = false;
}

/**
 * Ensure RNCallKeep native module is ready (Android: registers PhoneAccount).
 * Call during app startup before the first incoming call can arrive.
 */
export function ensureCallKeepNativeReady(): void {
  if (Platform.OS !== 'android' || !RNCallKeep) return;
  try {
    RNCallKeep.setup({ ios: IOS_OPTIONS, android: ANDROID_OPTIONS });
  } catch (_) {}
}

/**
 * Present the system incoming-call screen (iOS CallKit).
 *
 * Android: no-op — GywFirebaseMessagingService + GywIncomingCallService
 * handle display natively via full-screen intent.
 *
 * @param callId     - UUID matching the Firestore call document id.
 * @param callerName - Name displayed on the system call screen.
 * @param callType   - 'audio' or 'video'.
 */
export function displayIncomingCall(
  callId:     string,
  callerName: string,
  callType:   'audio' | 'video' = 'audio',
): void {
  if (!RNCallKeep) return;
  if (__DEV__) {
    console.log(
      `INCOMING_TRIGGER source=callkeep_display_${Platform.OS} callId=${callId} ts=${Date.now()}`
    );
  }

  if (Platform.OS === 'ios') {
    // (uuid, handle, localizedCallerName, handleType, hasVideo, callerName)
    RNCallKeep.displayIncomingCall(
      callId,
      callerName,
      'generic',
      callType === 'video',
      callerName,
    );
    if (__DEV__) console.log('[callkeep] iOS displayIncomingCall dispatched', callId);
    return;
  }

  // Android: do NOT call RNCallKeep.displayIncomingCall().
  // GywFirebaseMessagingService already calls TelecomManager.addNewIncomingCall()
  // → CallConnectionService / GywCallConnection. A second displayIncomingCall from JS
  // registers another incoming session and can crash the app or kill the process.
  // Accept opens MainActivity via gyw:// deep link; decline uses native + FCM cancel.
  if (__DEV__) {
    console.log(
      '[callkeep] Android displayIncomingCall skipped (native Telecom path owns incoming)',
      callId,
    );
  }
}

/**
 * Register an outgoing call with CallKit / TelecomManager.
 * Call this when the local user places a call (before the WebRTC offer).
 *
 * @param callId     - UUID of the call.
 * @param calleeName - Display name of the remote party.
 * @param callType   - 'audio' or 'video'.
 */
export function startOutgoingCall(
  callId:     string,
  calleeName: string,
  callType:   'audio' | 'video' = 'audio',
): void {
  if (!RNCallKeep) return;
  // (uuid, handle, contactIdentifier, handleType, hasVideo)
  RNCallKeep.startCall(callId, calleeName, calleeName, 'generic', callType === 'video');
}

/**
 * Programmatically answer an incoming call from JS.
 * Transitions CallKit / Telecom to the "answered" state and activates audio.
 *
 * @param callId - UUID of the incoming call.
 */
export function answerIncomingCall(callId: string): void {
  if (!RNCallKeep) return;
  RNCallKeep.answerIncomingCall(callId);
}

/**
 * End or hang up a call.
 * Removes it from CallKit / Telecom and stops any native ring UI.
 *
 * @param callId - UUID of the call to end.
 */
export function endCall(callId: string): void {
  if (!RNCallKeep) return;
  try { RNCallKeep.endCall(callId); } catch (_) {}
}

export function endAllCalls(): void {
  if (!RNCallKeep) return;
  try { RNCallKeep.endAllCalls(); } catch (_) {}
}

/**
 * Reject an unanswered incoming call.
 * Uses rejectCall semantics on CallKit; falls back to endCall if unavailable.
 *
 * @param callId - UUID of the incoming call to reject.
 */
export function rejectCall(callId: string): void {
  if (!RNCallKeep) return;
  try {
    RNCallKeep.rejectCall(callId);
  } catch (_) {
    endCall(callId);
  }
}

/**
 * Notify CallKit that an active call has ended.
 * Import this into the call screen and call it when the user taps hang-up.
 *
 * @param callId - UUID of the call that ended.
 */
export function reportCallEnded(callId: string): void {
  endCall(callId);
}

/**
 * Show or present a pending incoming call if one is cached in store.
 * Used from the incoming-call screen to restore state after a cold launch.
 *
 * @param callId     - UUID of the incoming call.
 * @param callerName - Caller display name.
 * @param callType   - 'audio' or 'video'.
 */
export function presentIncomingCallIfNeeded(
  callId:     string,
  callerName: string,
  callType:   'audio' | 'video',
): void {
  displayIncomingCall(callId, callerName, callType);
}

/**
 * Present an incoming call from a push data payload.
 * Called by NotificationService when an INCOMING_CALL FCM message arrives.
 *
 * @param data - FCM data payload with callId, callerName, callType.
 */
export function presentIncomingCallFromPushData(data: Record<string, unknown>): void {
  const callId     = String(data.callId ?? data.call_id ?? '');
  const callerName = String(data.callerName ?? data.caller_name ?? 'Incoming call');
  const callType   = data.callType === 'video' ? 'video' : 'audio';

  if (!callId) return;
  displayIncomingCall(callId, callerName, callType);
}

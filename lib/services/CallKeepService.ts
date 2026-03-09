import { Platform } from 'react-native';
import RNCallKeep, { IOptions as CallKeepOptions } from 'react-native-callkeep';

type CallType = 'audio' | 'video';

export interface DisplayIncomingCallParams {
  /**
   * Stable identifier for the call; should be a UUID string.
   * Use the same value when ending the call.
   */
  callUUID: string;
  /**
   * Phone number, user ID, or handle for the caller.
   */
  handle: string;
  /**
   * Display name shown in the native UI.
   */
  displayName: string;
  /**
   * Call media type, used to set the video flag.
   */
  type: CallType;
}

export interface AnswerCallEvent {
  callUUID: string;
  handle?: string;
}

export interface EndCallEvent {
  callUUID: string;
  reason?: string;
}

export interface MuteCallEvent {
  callUUID: string;
  muted: boolean;
}

type AnswerCallListener = (event: AnswerCallEvent) => void;
type EndCallListener = (event: EndCallEvent) => void;
type MuteCallListener = (event: MuteCallEvent) => void;

const answerCallListeners = new Set<AnswerCallListener>();
const endCallListeners = new Set<EndCallListener>();
const muteCallListeners = new Set<MuteCallListener>();

let isInitialized = false;
let eventsRegistered = false;

/**
 * Determine whether CallKeep is available on the current platform.
 */
function isCallKeepSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * Base CallKeep configuration shared across platforms.
 *
 * Android: selfManaged: true registers as a VoIP-only ConnectionService
 * (CAPABILITY_SELF_MANAGED), so the app does NOT handle system/telephony calls—
 * only in-app calls triggered by our FCM incoming_call payloads.
 *
 * Note: Some options (like Notification icons) are configured natively
 * via the Expo config plugin and Android/iOS manifests; this JS config
 * focuses on runtime behavior and must stay in sync with app.json.
 */
const baseOptions: CallKeepOptions = {
  ios: {
    appName: 'GYW',
    supportsVideo: true,
  },
  android: {
    alertTitle: 'In-app calls',
    alertDescription: 'This app needs permission to show in-app voice and video call UI only (not regular phone calls).',
    cancelButton: 'Cancel',
    okButton: 'OK',
    additionalPermissions: [],
    /**
     * VoIP-only: register as self-managed ConnectionService so we do NOT
     * handle system/telephony calls—only our own displayIncomingCall().
     */
    selfManaged: true,
    foregroundService: {
      channelId: 'incoming_calls',
      channelName: 'Incoming Calls',
      notificationTitle: 'GYW call',
    },
  },
};

/**
 * Register core CallKeep event handlers and fan them out to
 * locally-registered listeners.
 */
function registerEventHandlers() {
  if (eventsRegistered || !isCallKeepSupported()) {
    return;
  }

  try {
    RNCallKeep.addEventListener('answerCall', (data: any) => {
      const event: AnswerCallEvent = {
        callUUID: data.callUUID ?? data.uuid ?? '',
        handle: data.handle,
      };

      answerCallListeners.forEach((listener) => {
        try {
          listener(event);
        } catch (listenerError) {
          // Listener errors should not break global CallKeep handling.
          console.error('[CallKeepService] answerCall listener error', listenerError);
        }
      });
    });

    RNCallKeep.addEventListener('endCall', (data: any) => {
      const event: EndCallEvent = {
        callUUID: data.callUUID ?? data.uuid ?? '',
        reason: data.reason,
      };

      endCallListeners.forEach((listener) => {
        try {
          listener(event);
        } catch (listenerError) {
          console.error('[CallKeepService] endCall listener error', listenerError);
        }
      });
    });

    RNCallKeep.addEventListener('didPerformSetMutedCallAction', (data: any) => {
      const event: MuteCallEvent = {
        callUUID: data.callUUID ?? data.uuid ?? '',
        muted: Boolean(data.muted),
      };

      muteCallListeners.forEach((listener) => {
        try {
          listener(event);
        } catch (listenerError) {
          console.error(
            '[CallKeepService] didPerformSetMutedCallAction listener error',
            listenerError,
          );
        }
      });
    });

    eventsRegistered = true;
  } catch (error) {
    console.error('[CallKeepService] Failed to register CallKeep event handlers', error);
  }
}

/**
 * Initialize CallKeep and register native phone account / events.
 *
 * Call this once after the user is authenticated and the app is ready
 * to handle calls. Safe to call multiple times.
 */
export async function setupCallKeep(): Promise<void> {
  if (!isCallKeepSupported()) {
    return;
  }

  if (isInitialized) {
    return;
  }

  try {
    await RNCallKeep.setup(baseOptions);

    if (Platform.OS === 'android') {
      // Mark the app as able to receive and handle calls on Android.
      RNCallKeep.setAvailable(true);
    }

    registerEventHandlers();
    isInitialized = true;
  } catch (error) {
    console.error('[CallKeepService] setupCallKeep failed', error);
  }
}

/**
 * Display the native incoming call UI (CallKit / ConnectionService).
 *
 * On Android, this may throw when the app is in a killed state
 * ("Activity doesn't exist"). Callers should rely on logs and
 * consider a fallback notification for such cases.
 */
export async function displayIncomingCall(params: DisplayIncomingCallParams): Promise<void> {
  if (!isCallKeepSupported()) {
    return;
  }

  const { callUUID, handle, displayName, type } = params;

  const hasVideo = type === 'video';

  try {
    // Ensure setup has been attempted before displaying a call.
    if (!isInitialized) {
      await setupCallKeep();
    }

    await RNCallKeep.displayIncomingCall(
      callUUID,
      handle,
      displayName,
      'generic',
      hasVideo,
      {},
    );
  } catch (error) {
    // Common Android failure when app is killed:
    // "Activity doesn't exist" – the OS refuses to start UI.
    console.error('[CallKeepService] displayIncomingCall failed', error);
  }
}

/**
 * End a single active call by UUID.
 */
export async function endCall(callUUID: string): Promise<void> {
  if (!isCallKeepSupported()) {
    return;
  }

  try {
    await RNCallKeep.endCall(callUUID);
  } catch (error) {
    console.error('[CallKeepService] endCall failed', error);
  }
}

/**
 * End all active calls known to CallKeep.
 */
export async function endAllCalls(): Promise<void> {
  if (!isCallKeepSupported()) {
    return;
  }

  try {
    await RNCallKeep.endAllCalls();
  } catch (error) {
    console.error('[CallKeepService] endAllCalls failed', error);
  }
}

/**
 * Register a listener for CallKeep `answerCall` events.
 *
 * @returns cleanup function to remove the listener.
 */
export function addAnswerCallListener(listener: AnswerCallListener): () => void {
  answerCallListeners.add(listener);

  return () => {
    answerCallListeners.delete(listener);
  };
}

/**
 * Register a listener for CallKeep `endCall` events.
 *
 * @returns cleanup function to remove the listener.
 */
export function addEndCallListener(listener: EndCallListener): () => void {
  endCallListeners.add(listener);

  return () => {
    endCallListeners.delete(listener);
  };
}

/**
 * Register a listener for CallKeep `didPerformSetMutedCallAction` events.
 *
 * @returns cleanup function to remove the listener.
 */
export function addMuteCallListener(listener: MuteCallListener): () => void {
  muteCallListeners.add(listener);

  return () => {
    muteCallListeners.delete(listener);
  };
}


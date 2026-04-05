import AsyncStorage from '@react-native-async-storage/async-storage';

/** Written by FCM background handler; read on cold start to deep-link into Call screen. */
export const PENDING_CALL_INVITE_KEY = 'gyw:pendingCallInvite';

export type PendingCallInvite = {
  callId: string;
  callerId: string;
  callType: string;
  receivedAt: number;
};

export async function setPendingCallInvite(payload: PendingCallInvite): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_CALL_INVITE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export async function clearPendingCallInvite(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_CALL_INVITE_KEY);
  } catch {
    /* ignore */
  }
}

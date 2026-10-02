import type { Router } from 'expo-router';

import { acceptFlowLog } from '@/lib/call/acceptFlowTrace';
import { callNavTrace } from '@/lib/call/callNavTrace';
import { markCallAccepted } from '@/lib/call/incomingCallGuard';
import { callManagerActionsRef } from '@/lib/hooks/useCallManager';
import { callLatencyMark } from '@/lib/perf/callLatencyTrace';
import { useCallSessionStore } from '@/store/callSessionStore';

const handledAcceptCallIds = new Set<string>();

export type AnswerCallIntent = {
  callId: string;
  callType: 'audio' | 'video';
  /** Video only: false = answer without enabling camera (incoming UI toggle). */
  withCamera?: boolean;
};

/**
 * Navigate to the active call screen once per accept (dedupes native + Firestore + AppState).
 * Re-navigation remounts CallScreen and tears down WebRTC — skip if already on this call.
 */
export async function handleAnswerCallNavigation(
  router: Router,
  intent: AnswerCallIntent,
): Promise<boolean> {
  const { callId, callType, withCamera } = intent;
  if (!callId) return false;

  const isDuplicate = handledAcceptCallIds.has(callId);
  const sessionCallId = useCallSessionStore.getState().activeSessionCallId;
  const alreadyOnCallScreen = sessionCallId === callId;

  if (!isDuplicate) {
    handledAcceptCallIds.add(callId);
    setTimeout(() => handledAcceptCallIds.delete(callId), 60_000);
    markCallAccepted(callId, 'handleAnswerCallNavigation');
    console.log('ACCEPT_HANDLER_START', { callId, callType });
  }

  if (callType === 'video') {
    useCallSessionStore
      .getState()
      .setPendingAnswerWithCamera(withCamera !== false);
  }

  callLatencyMark(callId, 'ACCEPT_CLICKED');

  const route = `/(home)/call/${callId}?accept=1&callType=${callType}` as const;
  const skipReplace = isDuplicate || alreadyOnCallScreen;

  if (skipReplace) {
    acceptFlowLog('CALL_ACCEPT_NAVIGATION_SKIPPED', callId, {
      route,
      duplicate: isDuplicate,
      alreadyOnCallScreen,
      sessionCallId,
    });
    callNavTrace('CALL_ACCEPT_NAVIGATE_SKIPPED', callId, {
      callType,
      duplicate: isDuplicate,
      alreadyOnCallScreen,
    });
  } else {
    acceptFlowLog('CALL_ACCEPT_NAVIGATION_START', callId, { route, duplicate: false });
    callNavTrace('CALL_ACCEPT_NAVIGATE_TO_CALL', callId, { callType, duplicate: false });
    try {
      console.log('router.replace', route, { callId, callType });
      router.replace(route as never);
      acceptFlowLog('CALL_ACCEPT_NAVIGATION_SUCCESS', callId, { route });
    } catch (navErr) {
      acceptFlowLog('CALL_ACCEPT_NAVIGATION_FAILED', callId, {
        route,
        error: String(navErr),
      });
      throw navErr;
    }
  }

  if (!isDuplicate) {
    void callManagerActionsRef.answerCall(callId).finally(() => {
      console.log('ACCEPT_HANDLER_COMPLETE', { callId });
    });
  }
  return true;
}

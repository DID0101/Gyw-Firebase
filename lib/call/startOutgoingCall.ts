import type { Router } from 'expo-router';
import i18n from 'i18next';
import { Alert, InteractionManager } from 'react-native';

import { formatCallStartError } from '@/lib/call/formatCallStartError';
import {
  endCallSession,
  initiateCall,
  preGenerateCallId,
  writeOutgoingCallStub,
} from '@/lib/services/callService';
import { beginOutgoingCallerMediaPrep, webRTCService } from '@/lib/services/webrtcService';
import { navigateOnce } from '@/lib/safeAction';
import { syncCallerProfileToNative } from '@/lib/contacts/syncCallerProfilesToNative';
import { callLatencyStart } from '@/lib/perf/callLatencyTrace';
import { trackVideoCallStarted, trackVoiceCallStarted } from '@/lib/services/analyticsService';
import { useCallManagerStore } from '@/store/callManagerStore';

export type StartOutgoingCallParams = {
  router: Router;
  callerId: string;
  calleeId: string;
  callType: 'audio' | 'video';
  chatId?: string;
  callerName?: string;
  callerAvatar?: string;
};

async function cancelOutgoingCallId(prevId: string, callerId: string): Promise<void> {
  const { getCall } = await import('@/lib/services/callService');
  try {
    const prev = await getCall(prevId);
    if (prev && !['ended', 'missed', 'declined', 'rejected', 'busy', 'canceled', 'cancelled', 'timeout'].includes(prev.status)) {
      await endCallSession(prevId, 'cancelled');
    }
  } catch {
    /* ignore — doc may not exist */
  }
  webRTCService.cleanup(prevId);
  if (__DEV__) {
    console.log('[CALL] cancelled previous outgoing before new call', {
      prevId,
      callerId,
    });
  }
}

/**
 * Navigate to the call screen immediately, then write stub + initiateCall in the background.
 */
export function startOutgoingCall(params: StartOutgoingCallParams): string {
  if (params.callType === 'video') {
    void trackVideoCallStarted();
  } else {
    void trackVoiceCallStarted();
  }
  const prevActiveCallId = useCallManagerStore.getState().activeCallId;
  const callId = preGenerateCallId();
  callLatencyStart(callId, 'CALL_START_T0');
  useCallManagerStore.getState().setActiveCallId(callId);
  if (params.callerName?.trim()) {
    syncCallerProfileToNative(params.callerId, {
      name: params.callerName.trim(),
      avatar: params.callerAvatar,
    });
  }

  const query = new URLSearchParams({
    callType: params.callType,
    targetUserId: params.calleeId,
    isOutgoing: 'true',
  });
  if (params.chatId) query.set('chatId', params.chatId);

  const callRoute = `/(home)/call/${callId}?${query.toString()}` as const;
  // Defer push until chat layout/keyboard animations finish — avoids Reanimated
  // manageChildren crash when the chat screen unmounts under the call route.
  InteractionManager.runAfterInteractions(() => {
    navigateOnce(params.router, 'push', callRoute as never);
  });

  // Overlap camera/PC warmup with stub + CF — call screen reuses via hasPreparedMedia().
  void beginOutgoingCallerMediaPrep(
    callId,
    params.callType === 'video',
    params.callerId,
    params.calleeId,
  ).catch(() => {});

  void (async () => {
    try {
      if (prevActiveCallId && prevActiveCallId !== callId) {
        await cancelOutgoingCallId(prevActiveCallId, params.callerId);
      }
      await writeOutgoingCallStub({
        callId,
        callerId: params.callerId,
        calleeId: params.calleeId,
        callType: params.callType,
        chatId: params.chatId,
        callerName: params.callerName,
        callerAvatar: params.callerAvatar,
      });
      await initiateCall({
        callId,
        callerId: params.callerId,
        calleeId: params.calleeId,
        callType: params.callType,
        chatId: params.chatId,
        callerName: params.callerName,
        callerAvatar: params.callerAvatar,
      });
    } catch (err) {
      if (__DEV__) console.error('[CALL] initiation failed', err);
      Alert.alert(i18n.t('common.error'), formatCallStartError(err));
      if (params.router.canGoBack()) {
        params.router.back();
      } else {
        params.router.replace('/(home)/(tabs)/chats' as never);
      }
    }
  })();

  return callId;
}

/**
 * Incoming call screen — reads Zustand incomingCall (set before navigation).
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import AudioIncomingCallUI from '@/components/calls/incoming/audio/AudioIncomingCallUI';
import VideoIncomingCallUI from '@/components/calls/incoming/video/VideoIncomingCallUI';
import type { IncomingCallData } from '@/constants/CallTheme';
import { useAuth } from '@/contexts/AuthContext';
import { handleAnswerCallNavigation } from '@/lib/call/handleAnswerCallNavigation';
import { declineCall } from '@/lib/services/callService';
import { sendMessage } from '@/lib/services/chatService';
import {
  logCallDismissingIncoming,
  logCallIncomingMounted,
  logCallIncomingUnmounted,
} from '@/lib/call/callDevLog';
import { clearIncomingNavigationLock } from '@/lib/call/openIncomingCall';
import { markCallDismissed } from '@/lib/call/incomingCallGuard';
import { resolveCallerDisplayName } from '@/lib/contacts/contactResolver';
import {
  useCallStore,
  type IncomingCallStoreData,
} from '@/store/callStore';
import { useContactsStore } from '@/store/contactsStore';
const TERMINAL = new Set([
  'ended',
  'missed',
  'declined',
  'rejected',
  'busy',
  'canceled',
  'cancelled',
  'timeout',
]);

function CallLoadingScreen() {
  return (
    <View style={loadingStyles.root}>
      <ActivityIndicator size="large" color="#ffffff" />
      <Text allowFontScaling={false} style={loadingStyles.label}>
        Incoming call…
      </Text>
    </View>
  );
}

const loadingStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0D1B2A',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  label: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 16,
    fontWeight: '500',
  },
});

function toIncomingCallData(
  data: IncomingCallStoreData,
  callerPhone?: string | null
): IncomingCallData {
  const displayName = resolveCallerDisplayName({
    callerName: data.callerName,
    callerPhone: callerPhone ?? data.callerPhone,
  });
  return {
    callId: data.callId,
    callType: data.callType,
    caller: {
      uid: data.callerId,
      displayName,
      photoURL: data.callerAvatar,
    },
    timestamp: data.timestamp,
  };
}

export default function IncomingCallScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    callId?: string;
    callerName?: string;
    callerAvatar?: string;
    callType?: string;
  }>();

  const storeCallData = useCallStore((s) => s.incomingCall);
  const contactsRevision = useContactsStore((s) => s.revision);
  const callId = params.callId ?? storeCallData?.callId;
  const callData = storeCallData;

  const hasHandledRef = useRef(false);

  const uiCallData = useMemo(
    () => (callData ? toIncomingCallData(callData, callData.callerPhone) : null),
    [callData, contactsRevision],
  );

  useEffect(() => {
    if (!callData && !callId) {
      const timer = setTimeout(() => {
        if (!hasHandledRef.current) {
          try {
            router.back();
          } catch (_) {}
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [callData, callId, router]);

  useEffect(() => {
    const status = callData?.status;
    if (!status) return;
    if (status === 'cancelled' || status === 'canceled' || status === 'ended' || TERMINAL.has(status)) {
      if (!hasHandledRef.current) {
        hasHandledRef.current = true;
        if (callId) markCallDismissed(callId);
        logCallDismissingIncoming(`status_${status}`, { callId, status });
        clearIncomingNavigationLock(callId);
        try {
          router.back();
        } catch (_) {}
        setTimeout(() => useCallStore.getState().clearIncomingCall(), 300);
      }
    }
  }, [callData?.status, callId, router]);

  const handleAccept = useCallback(async () => {
    if (!callId || hasHandledRef.current) return;
    hasHandledRef.current = true;
    clearIncomingNavigationLock(callId);
    const ct = callData?.callType === 'video' ? 'video' : 'audio';
    await handleAnswerCallNavigation(router, { callId, callType: ct });
  }, [callId, callData?.callType, router]);

  const handleDecline = useCallback(async () => {
    if (!callId || hasHandledRef.current) return;
    hasHandledRef.current = true;
    markCallDismissed(callId);
    clearIncomingNavigationLock(callId);
    await declineCall(callId);
    try {
      router.back();
    } catch (_) {}
    setTimeout(() => useCallStore.getState().clearIncomingCall(), 300);
  }, [callId, router]);

  const handleVideoAccept = useCallback(
    async (opts: { withCamera: boolean }) => {
      if (!callId || hasHandledRef.current) return;
      hasHandledRef.current = true;
      clearIncomingNavigationLock(callId);
      await handleAnswerCallNavigation(router, {
        callId,
        callType: 'video',
        withCamera: opts.withCamera,
      });
    },
    [callId, router],
  );

  const handleQuickMessage = useCallback(
    async (text: string) => {
      if (!user || !callData?.chatId) return;
      try {
        await sendMessage(
          callData.chatId,
          user.uid,
          user.displayName ?? 'You',
          user.photoURL ?? undefined,
          text,
        );
      } catch (e) {
        if (__DEV__) console.warn('[incoming] quick message failed', e);
      }
    },
    [user, callData?.chatId],
  );

  if (!uiCallData) {
    return <CallLoadingScreen />;
  }

  if (uiCallData.callType === 'video') {
    return (
      <VideoIncomingCallUI
        callData={uiCallData}
        onAccept={handleVideoAccept}
        onDecline={handleDecline}
        onMessage={callData.chatId ? handleQuickMessage : undefined}
      />
    );
  }

  return (
    <AudioIncomingCallUI
      callData={uiCallData}
      onAccept={handleAccept}
      onDecline={handleDecline}
      onMessage={callData.chatId ? handleQuickMessage : undefined}
    />
  );
}

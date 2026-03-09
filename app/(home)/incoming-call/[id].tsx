/**
 * Incoming call screen with continuous ringtone.
 * Shown when user receives a call notification and taps it (or app wakes).
 * Plays ringtone loop until Accept/Decline.
 */
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import PreviewAvatar from '@/components/PreviewAvatar';
import Screen from '@/components/Screen';
import { useIncomingCallRinger } from '@/components/IncomingCallRinger';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { getCall, sendSignalingMessage, subscribeToCall, updateCallStatus } from '@/lib/services/callService';
import { getUser } from '@/lib/services/chatService';
import { Call } from '@/lib/types/call';
import { User } from '@/lib/types/chat';

export default function IncomingCallScreen() {
  const { id: callId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const [call, setCall] = useState<Call | null>(null);
  const [otherUser, setOtherUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);

  const isRinging = call?.status === 'ringing';
  const { stop: stopRinger } = useIncomingCallRinger(isRinging);

  const mountedAtRef = useRef<number | null>(null);
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    mountedAtRef.current = Date.now();
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  const redirectToChats = useCallback(
    (reason: string) => {
      if (hasRedirectedRef.current) return;
      hasRedirectedRef.current = true;

      const now = Date.now();
      const mountedAt = mountedAtRef.current ?? now;
      const elapsed = now - mountedAt;
      const minVisibleMs = 3000;
      const remaining = Math.max(minVisibleMs - elapsed, 0);

      console.log('[IncomingCallScreen] Scheduling redirect to chats', {
        reason,
        elapsedMs: elapsed,
        delayMs: remaining,
      });

      const doRedirect = () => {
        console.log('[IncomingCallScreen] Redirecting to chats', { reason });
        router.replace('/(home)/(tabs)/chats');
      };

      if (remaining <= 0) {
        doRedirect();
      } else {
        redirectTimeoutRef.current = setTimeout(doRedirect, remaining);
      }
    },
    [router],
  );

  useEffect(() => {
    if (!callId || !user) return;

    const loadCall = async () => {
      try {
        const callData = await getCall(callId);
        if (!callData) {
          console.log('[IncomingCallScreen] No call data found, redirecting', { callId });
          redirectToChats('no_call_data');
          return;
        }
        if (['ended', 'missed', 'rejected'].includes(callData.status)) {
          console.log('[IncomingCallScreen] Call already finished on load', {
            callId,
            status: callData.status,
          });
          setCall(callData);
          redirectToChats(`initial_status_${callData.status}`);
          return;
        }
        console.log('[IncomingCallScreen] Call loaded', {
          callId,
          status: callData.status,
        });
        setCall(callData);
        const otherUserId = callData.callerId === user.uid ? callData.receiverId : callData.callerId;
        const otherUserData = await getUser(otherUserId);
        setOtherUser(otherUserData);
      } catch {
        console.log('[IncomingCallScreen] Failed to load call, redirecting', { callId });
        redirectToChats('load_error');
      } finally {
        setLoading(false);
      }
    };

    loadCall();
  }, [callId, user?.uid]);

  useEffect(() => {
    if (!callId) return;

    const unsubscribe = subscribeToCall(callId, (callData) => {
      if (!callData || ['ended', 'missed', 'rejected'].includes(callData.status)) {
        console.log('[IncomingCallScreen] Call finished via subscription', {
          callId,
          status: callData?.status ?? 'missing',
        });
        stopRinger();
        redirectToChats(`subscription_status_${callData?.status ?? 'missing'}`);
        return;
      }
      console.log('[IncomingCallScreen] Call update via subscription', {
        callId,
        status: callData.status,
      });
      setCall(callData);
    });

    return unsubscribe;
  }, [callId, redirectToChats, stopRinger]);

  const handleAccept = async () => {
    if (!call || !user) return;
    setIsAccepting(true);
    stopRinger();
    router.replace(`/(home)/call/${callId}?accept=1`);
  };

  const handleDecline = async () => {
    if (!call || !user) return;
    stopRinger();
    try {
      const callerId = call.callerId;
      await updateCallStatus(callId!, 'rejected', undefined, call.chatId);
      await sendSignalingMessage(callId!, user.uid, callerId, 'hangup');
    } catch (_) {}
    router.replace('/(home)/(tabs)/chats');
  };

  if (loading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator size="large" />
      </Screen>
    );
  }

  if (!call) return null;

  const displayName = otherUser
    ? `${otherUser.firstName || ''} ${otherUser.lastName || ''}`.trim() || otherUser.username || t('calls.unknown')
    : t('calls.unknown');
  const isVideo = call.type === 'video';

  return (
    <Screen className="flex-1 items-center justify-between bg-black/95 pb-16 pt-24">
      <View className="items-center">
        <Text className="mb-2 text-lg text-white/80">
          {isVideo ? t('calls.incomingVideoCall') : t('calls.incomingAudioCall')}
        </Text>
        <PreviewAvatar
          user={otherUser}
          size={100}
          className="mb-4"
        />
        <Text className="text-2xl font-semibold text-white" numberOfLines={1}>
          {displayName}
        </Text>
        <Text className="mt-2 text-white/70">Ringing...</Text>
      </View>

      <View className="flex-row gap-12">
        <Pressable
          onPress={handleDecline}
          className="h-16 w-16 items-center justify-center rounded-full bg-red-600"
          accessibilityLabel={t('calls.decline')}
        >
          <Feather name="phone-off" size={28} color="white" />
        </Pressable>
        <Pressable
          onPress={handleAccept}
          disabled={isAccepting}
          className="h-16 w-16 items-center justify-center rounded-full bg-green-600"
          accessibilityLabel={t('calls.accept')}
        >
          <Feather name="phone" size={28} color="white" />
        </Pressable>
      </View>
    </Screen>
  );
}

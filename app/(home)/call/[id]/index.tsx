import { Feather, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, Text, View } from 'react-native';
import InCallManager from 'react-native-incall-manager';

import { dismissCallKeepForCallId } from '@/lib/incomingCallInvite';
import { startIncomingCallVibration, stopIncomingCallVibration } from '@/lib/incomingCallVibration';

// Conditional import for react-native-webrtc (requires dev build)
import { RTCPeerConnection, RTCView, isWebRTCAvailable } from '@/lib/webrtc-wrapper';

import PreviewAvatar from '@/components/PreviewAvatar';
import Screen from '@/components/Screen';
import ScreenLoading from '@/components/ScreenLoading';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { app, functions, httpsCallable } from '@/lib/firebase';
import { blockUser, reportUser } from '@/lib/services/blockReportService';
import { getCall, subscribeToCall, updateCallReceiverReady, updateCallStatus, waitForReceiverReady } from '@/lib/services/callService';
import { useCallSessionStore } from '@/store/callSessionStore';
import { getUser } from '@/lib/services/chatService';
import { webRTCService } from '@/lib/services/webrtcService';
import { Call } from '@/lib/types/call';
import { User } from '@/lib/types/chat';

const CallScreen = () => {
  const { id: callId, accept: acceptParam } = useLocalSearchParams<{ id: string; accept?: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const { colorScheme, isDark } = useTheme();
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';
  
  const [call, setCall] = useState<Call | null>(null);
  const [otherUser, setOtherUser] = useState<User | null>(null);
  const [callStatus, setCallStatus] = useState<'ringing' | 'active' | 'ended'>('ringing');
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerEnabled, setIsSpeakerEnabled] = useState(true);
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isCaller, setIsCaller] = useState(false);
  
  const callStartTime = useRef<number>(0);
  const callRingStartTime = useRef<number>(0);
  const durationInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const missedCallTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteStreamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localStreamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializedRef = useRef<string | null>(null);
  const callStateRef = useRef<Call | null>(null);
  const isNavigatingAwayRef = useRef(false);
  const weJustEndedRef = useRef(false);
  const iceFailureDetectedRef = useRef(false);

  const textColor = isDark ? 'text-white' : 'text-black';
  const bgColor = isDark ? 'bg-gray-900' : 'bg-white';

  const safeBack = (opts?: { disconnected?: boolean }) => {
    if (isNavigatingAwayRef.current) return;
    isNavigatingAwayRef.current = true;
    void useCallSessionStore.getState().reset();
    const current = callStateRef.current;
    const isRandom = current?.isRandom === true;
    const path = isRandom
      ? `/(home)/(tabs)/discover${opts?.disconnected ? '?disconnected=1' : ''}`
      : '/(home)/(tabs)/chats';
    console.log('safeBack: exiting call screen', { isRandom, path });
    router.replace(path as any);
  };

  useEffect(() => {
    callStateRef.current = call;
  }, [call]);

  // Incoming (non-random): system default ringtone + wake screen while callee sees ringing UI
  useEffect(() => {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
    const random = call?.isRandom === true;
    const incomingRing = callStatus === 'ringing' && !isCaller && !random;
    if (incomingRing) {
      try {
        InCallManager.pokeScreen(10_000);
        InCallManager.startRingtone('_DEFAULT_', [0, 700, 400, 700]);
        startIncomingCallVibration();
      } catch {
        /* ignore */
      }
    } else {
      try {
        InCallManager.stopRingtone();
        stopIncomingCallVibration();
      } catch {
        /* ignore */
      }
    }
    return () => {
      try {
        InCallManager.stopRingtone();
        stopIncomingCallVibration();
      } catch {
        /* ignore */
      }
    };
  }, [callStatus, isCaller, call?.isRandom]);

  useEffect(() => {
    if (!callId || !user) return;
    
    // CRITICAL: Block re-initialization immediately
    if (initializedRef.current === callId) return;
    initializedRef.current = callId;

    console.log('Initializing CallScreen for:', callId);

    const loadCall = async () => {
      try {
        const callData = await getCall(callId);
        if (!callData) {
          Alert.alert(t('common.error'), t('call.sessionNotFound'));
          safeBack();
          return;
        }

        if (['ended', 'missed', 'rejected'].includes(callData.status)) {
          setCall(callData);
          setCallStatus(callData.status as any);
          setTimeout(() => safeBack(), 1500);
          return;
        }

        setCall(callData);
        const otherUserId = callData.callerId === user.uid ? callData.receiverId : callData.callerId;
        const otherUserData = await getUser(otherUserId);
        if (otherUserData) setOtherUser(otherUserData);

        // For random calls: deterministic offerer (smaller UID creates offer) to prevent offer collision
        const isRandom = callData.isRandom === true;
        const offererId = callData.callerId < callData.receiverId ? callData.callerId : callData.receiverId;
        const answererId = callData.callerId < callData.receiverId ? callData.receiverId : callData.callerId;
        const isOfferer = isRandom ? user.uid === offererId : callData.callerId === user.uid;
        setIsCaller(isOfferer);
        setCallStatus(callData.status as any);

        if (!isWebRTCAvailable || !RTCView || !RTCPeerConnection) {
          Alert.alert(t('common.error'), t('call.webrtcNotAvailable'));
          safeBack();
          return;
        }

        // Set up missed call timeout (20-25s for random, 30s for regular)
        if (callData.status === 'ringing') {
          callRingStartTime.current = Date.now();
          const timeoutMs = 60000; // 60s ringing; server also marks stale ringing as missed
          missedCallTimeoutRef.current = setTimeout(async () => {
            const currentCall = callStateRef.current;
            if (currentCall && currentCall.status === 'ringing') {
              await updateCallStatus(callId, 'missed', 0, currentCall.chatId);
            }
          }, timeoutMs);
        }

        const handleIceFailure = () => {
          if (callData.isRandom && !iceFailureDetectedRef.current) {
            iceFailureDetectedRef.current = true;
            Alert.alert(
              t('call.connectionFailed'),
              t('call.unableToConnect'),
              [{ text: t('common.ok'), onPress: () => {
                weJustEndedRef.current = true;
                handleEndCall(undefined, false);
              }}]
            );
          }
        };

        if (isOfferer) {
          await initializeWebRTC(callData, otherUserId, isOfferer, offererId, answererId);
        } else if (isRandom) {
          // Random match: connect media immediately (Omegle-style)
          webRTCService.setupSignaling(
            callId,
            user.uid,
            otherUserId,
            false,
            (remote) => {
              console.log('Remote stream detected (Answerer)');
              setRemoteStream(remote);
            },
            handleIceFailure
          );
          await webRTCService.initializePeerConnection(callId);
          InCallManager.start({ media: callData.type === 'video' ? 'video' : 'audio' });
          InCallManager.setSpeakerphoneOn(callData.type === 'video');
          const stream = await webRTCService.requestLocalStream(callId, callData.type === 'video');
          setLocalStream(stream);
          await updateCallReceiverReady(callId);
        }
        // Regular callee: no signaling / peer connection until Accept (or ConnectionService answer → accept=1)

        // System-level answer (CallKeep) — same as tapping Accept
        if (acceptParam === '1' && !isRandom && !isOfferer && callData.status === 'ringing') {
          await doAcceptCall(callData, otherUserData);
        }

        // Omegle-style: auto-accept random calls immediately (no ringing UI)
        if (isRandom && callData.status === 'ringing') {
          await doAcceptCall(callData, otherUserData);
        }
      } catch (error) {
        console.error('loadCall Error:', error);
        safeBack();
      } finally {
        setLoading(false);
      }
    };

    loadCall();

    const unsubscribe = subscribeToCall(callId, (callData) => {
      if (!callData) {
        safeBack();
        return;
      }
      setCall(callData);
      setCallStatus(callData.status as any);
      if (['ended', 'missed', 'rejected'].includes(callData.status)) {
        if (__DEV__) console.log('[CallScreen] call ended remotely', { status: callData.status, callId });
        const strangerLeft = callData.isRandom && !weJustEndedRef.current;
        handleEndCall(callData, strangerLeft);
      }
    });

    return () => {
      unsubscribe();
      InCallManager.stop();
      webRTCService.cleanup(callId);
      void useCallSessionStore.getState().reset();
      if (durationInterval.current) clearInterval(durationInterval.current);
      if (missedCallTimeoutRef.current) clearTimeout(missedCallTimeoutRef.current);
      if (remoteStreamIntervalRef.current) clearInterval(remoteStreamIntervalRef.current);
      if (localStreamIntervalRef.current) clearInterval(localStreamIntervalRef.current);
    };
  }, [callId, user?.uid]);

  const initializeWebRTC = async (
    callData: Call,
    otherUserId: string,
    isOfferer: boolean,
    offererId?: string,
    answererId?: string
  ) => {
    try {
      const isVideo = callData.type === 'video';
      setIsSpeakerEnabled(isVideo);

      InCallManager.start({ media: isVideo ? 'video' : 'audio' });
      InCallManager.setSpeakerphoneOn(isVideo);

      const handleIceFailure = () => {
        const currentCall = callStateRef.current;
        if (currentCall?.isRandom && !iceFailureDetectedRef.current) {
          iceFailureDetectedRef.current = true;
          Alert.alert(
            t('call.connectionFailed'),
            t('call.unableToConnect'),
            [{ text: t('common.ok'), onPress: () => {
              weJustEndedRef.current = true;
              handleEndCall(undefined, false);
            }}]
          );
        }
      };

      webRTCService.setupSignaling(
        callId,
        user!.uid,
        otherUserId,
        isOfferer,
        (remote) => {
          setRemoteStream(remote);
        },
        handleIceFailure
      );

      // 1. getUserMedia + addTrack BEFORE createOffer (required)
      const stream = await webRTCService.requestLocalStream(callId, isVideo);
      setLocalStream(stream);

      if (isOfferer && callData.status === 'ringing') {
        if (callData.isRandom && offererId && answererId) {
          await waitForReceiverReady(callId, 8000);
        }
        const from = callData.isRandom && offererId ? offererId : user!.uid;
        const to = callData.isRandom && answererId ? answererId : otherUserId;
        await webRTCService.createOffer(callId, from, to);
      }

      remoteStreamIntervalRef.current = setInterval(() => {
        const remote = webRTCService.getRemoteStream();
        if (remote && remote.getTracks().length > 0) setRemoteStream(remote);
      }, 300);

      localStreamIntervalRef.current = setInterval(() => {
        const local = webRTCService.getLocalStream();
        if (local && local.getTracks().length > 0) setLocalStream(local);
      }, 300);

    } catch (error: any) {
      console.error('initializeWebRTC Error:', error);
      // Don't alert for context-switch - user navigated to different call
      if (error?.message?.includes('context switched')) {
        return;
      }
      Alert.alert(t('call.mediaError'), t('call.couldNotAccessCameraMic'));
      safeBack();
    }
  };

  const doAcceptCall = async (callData: Call, _otherUserData: User | null) => {
    if (!user) return;
    try {
      const isVideo = callData.type === 'video';
      const otherUserId = callData.callerId === user.uid ? callData.receiverId : callData.callerId;
      const isRegularCallee = !callData.isRandom && callData.receiverId === user.uid;

      setIsSpeakerEnabled(isVideo);
      try {
        InCallManager.stopRingtone();
        stopIncomingCallVibration();
      } catch {
        /* ignore */
      }

      if (isRegularCallee) {
        const handleIceFailure = () => {
          if (iceFailureDetectedRef.current) return;
          iceFailureDetectedRef.current = true;
          Alert.alert(
            t('call.connectionFailed'),
            t('call.unableToConnect'),
            [{ text: t('common.ok'), onPress: () => {
              weJustEndedRef.current = true;
              handleEndCall(undefined, false);
            }}]
          );
        };
        webRTCService.setupSignaling(
          callId,
          user.uid,
          otherUserId,
          false,
          (remote) => setRemoteStream(remote),
          handleIceFailure
        );
        await webRTCService.initializePeerConnection(callId);
        InCallManager.start({ media: isVideo ? 'video' : 'audio' });
        InCallManager.setSpeakerphoneOn(isVideo);
        const stream = await webRTCService.requestLocalStream(callId, isVideo);
        setLocalStream(stream);
      } else {
        InCallManager.start({ media: isVideo ? 'video' : 'audio' });
        InCallManager.setSpeakerphoneOn(isVideo);
        const stream = callData.isRandom
          ? webRTCService.getLocalStream()
          : await webRTCService.requestLocalStream(callId, isVideo);
        if (stream) setLocalStream(stream);
      }

      await updateCallStatus(callId, 'active');
      setCallStatus('active');
      callStartTime.current = Date.now();

      if (missedCallTimeoutRef.current) {
        clearTimeout(missedCallTimeoutRef.current);
        missedCallTimeoutRef.current = null;
      }

      remoteStreamIntervalRef.current = setInterval(() => {
        const remote = webRTCService.getRemoteStream();
        if (remote && remote.getTracks().length > 0) setRemoteStream(remote);
      }, 300);

      localStreamIntervalRef.current = setInterval(() => {
        const local = webRTCService.getLocalStream();
        if (local && local.getTracks().length > 0) setLocalStream(local);
      }, 300);

      durationInterval.current = setInterval(() => {}, 1000) as any;
    } catch (error) {
      console.error('Accept Error:', error);
    }
  };

  const handleAcceptCall = async () => {
    if (!call || !user || callStatus !== 'ringing') return;
    await doAcceptCall(call, otherUser);
  };

  const handleRejectCall = async () => {
    const currentCall = callStateRef.current;
    if (!currentCall) return;
    try {
      InCallManager.stop();
      stopIncomingCallVibration();
      await updateCallStatus(callId, 'rejected', undefined, currentCall.chatId);
      void dismissCallKeepForCallId(callId);
      const { sendSignalingMessage } = await import('@/lib/services/callService');
      await sendSignalingMessage(callId, user!.uid, currentCall.receiverId === user!.uid ? currentCall.callerId : currentCall.receiverId, 'hangup');
      webRTCService.cleanup(callId);
      safeBack();
    } catch (error) {
      console.error('Reject Error:', error);
      safeBack();
    }
  };

  const handleEndCall = async (terminalCall?: Call, strangerLeft?: boolean) => {
    const currentCall = terminalCall || callStateRef.current;
    if (!currentCall) return;
    try {
      InCallManager.stop();
      stopIncomingCallVibration();
      void dismissCallKeepForCallId(callId);
      const duration = callStartTime.current > 0 ? Math.floor((Date.now() - callStartTime.current) / 1000) : 0;
      if (!['ended', 'missed', 'rejected'].includes(currentCall.status)) {
        await updateCallStatus(callId, 'ended', duration, currentCall.chatId);
        const { sendSignalingMessage } = await import('@/lib/services/callService');
        await sendSignalingMessage(callId, user!.uid, currentCall.callerId === user!.uid ? currentCall.receiverId : currentCall.callerId, 'hangup');
      }
      webRTCService.cleanup(callId);
      safeBack(strangerLeft ? { disconnected: true } : undefined);
    } catch (error) {
      console.error('EndCall Error:', error);
      safeBack(strangerLeft ? { disconnected: true } : undefined);
    }
  };

  const handleNextStranger = async () => {
    if (!user?.uid) return;
    try {
      let allowed: boolean;
      if (Platform.OS === 'web') {
        const checkSkipFn = httpsCallable<{ userId: string }, { allowed: boolean }>(
          functions,
          'checkSkipRateLimit'
        );
        const result = await checkSkipFn({ userId: user.uid });
        allowed = result.data.allowed;
      } else {
        // RN Firebase httpsCallable doesn't attach auth token. Use REST with explicit token.
        const { getApp } = require('@react-native-firebase/app');
        const { getAuth, getIdToken } = require('@react-native-firebase/auth');
        const rnApp = getApp();
        const auth = getAuth(rnApp);
        if (!auth.currentUser) throw new Error('UNAUTHENTICATED');
        const idToken = await getIdToken(auth.currentUser, true);
        const projectId = rnApp?.options?.projectId ?? app?.options?.projectId ?? 'gyw1-146d7';
        const res = await fetch(`https://us-central1-${projectId}.cloudfunctions.net/checkSkipRateLimit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
          body: JSON.stringify({ data: { userId: user.uid } }),
        });
        const rawText = await res.text();
        let json: { result?: { allowed?: boolean }; error?: { code?: string; message?: string } } = {};
        try {
          json = rawText.startsWith('{') ? JSON.parse(rawText) : {};
        } catch {
          if (__DEV__) console.warn('[checkSkipRateLimit] Non-JSON response', { status: res.status, preview: rawText.slice(0, 80) });
        }
        if (json?.error) throw Object.assign(new Error(json.error.message ?? 'Callable failed'), { code: json.error.code });
        allowed = typeof json?.result?.allowed === 'boolean' ? json.result.allowed : true;
      }
      if (!allowed) {
        Alert.alert('', t('discover.skipRateLimit'));
        return;
      }
      weJustEndedRef.current = true;
      await handleEndCall(undefined, false);
    } catch (err) {
      console.error('Skip rate limit check failed:', err);
      // Allow skip on error (fail open)
      weJustEndedRef.current = true;
      await handleEndCall(undefined, false);
    }
  };

  const handleBlock = () => {
    const otherUserId = call?.callerId === user?.uid ? call?.receiverId : call?.callerId;
    if (!otherUserId || !user?.uid) return;
    Alert.alert(
      t('discover.block'),
      t('discover.blockMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('discover.block'), style: 'destructive', onPress: async () => {
          await blockUser(user.uid, otherUserId);
          weJustEndedRef.current = true;
          await handleEndCall(undefined, false);
        } },
      ]
    );
  };

  const handleReport = () => {
    const otherUserId = call?.callerId === user?.uid ? call?.receiverId : call?.callerId;
    if (!otherUserId || !user?.uid) return;
    Alert.alert(
      t('discover.report'),
      t('discover.reportMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('discover.report'), onPress: async () => {
          await reportUser(user.uid, otherUserId, { callId });
          weJustEndedRef.current = true;
          await handleEndCall(undefined, false);
        } },
      ]
    );
  };

  const toggleVideo = () => {
    setIsVideoEnabled(!isVideoEnabled);
    webRTCService.toggleVideo(!isVideoEnabled);
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    webRTCService.toggleMute(!isMuted);
  };

  const toggleSpeaker = () => {
    setIsSpeakerEnabled(!isSpeakerEnabled);
    InCallManager.setSpeakerphoneOn(!isSpeakerEnabled);
  };

  const switchCamera = () => webRTCService.switchCamera();

  if (loading) return <ScreenLoading />;

  const isRandom = call?.isRandom === true;
  const displayName = isRandom
    ? (otherUser?.firstName?.trim() || t('discover.stranger'))
    : (otherUser ? `${otherUser.firstName} ${otherUser.lastName}`.trim() || otherUser.username : 'User');
  const isVideoCall = call?.type === 'video';

  return (
    <Screen viewClassName={`flex-1 ${bgColor}`}>
      {isVideoCall && remoteStream && callStatus === 'active' && RTCView && (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <RTCView streamURL={remoteStream.toURL()} objectFit="cover" style={{ flex: 1 }} zOrder={0} />
        </View>
      )}

      {isVideoCall && localStream && RTCView && (callStatus === 'active' || (callStatus === 'ringing' && (isCaller || isRandom))) && (
        <View className="absolute top-16 right-4 w-32 h-48 rounded-lg overflow-hidden border-2 border-white" style={{ zIndex: 10 }}>
          <RTCView streamURL={localStream.toURL()} objectFit="cover" style={{ flex: 1 }} mirror zOrder={1} />
        </View>
      )}
      
      {(!isVideoCall || callStatus !== 'active' || !remoteStream) && (
        <View className="flex-1 items-center justify-center p-8">
          <PreviewAvatar name={displayName} image={otherUser?.avatar} size={120} fontSize={48} />
          <Text className={`text-2xl font-semibold mt-6 ${textColor}`}>{displayName}</Text>
          <Text className={`text-base mt-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            {callStatus === 'ringing'
              ? (isRandom ? t('calls.connecting') : (isCaller ? t('calls.calling') : t('calls.incomingCall')))
              : callStatus === 'active'
              ? t('calls.connected')
              : t('calls.callEnded')}
          </Text>
        </View>
      )}

      <View className={`absolute bottom-0 left-0 right-0 p-6 ${bgColor} border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        {callStatus === 'ringing' && !isCaller && !isRandom && (
          <View className="flex-row justify-center gap-4 mb-4">
            <Pressable onPress={handleRejectCall} className="w-16 h-16 rounded-full bg-red-500 items-center justify-center">
              <Ionicons name="call" size={24} color="white" />
            </Pressable>
            <Pressable onPress={handleAcceptCall} className="w-16 h-16 rounded-full bg-green-500 items-center justify-center">
              <Ionicons name="call" size={24} color="white" />
            </Pressable>
          </View>
        )}

        {callStatus === 'active' && (
          <>
            {isRandom && (
              <View className="mb-3 flex-row justify-center gap-3">
                <Pressable onPress={handleReport} className="rounded-full px-4 py-2" style={{ backgroundColor: isDark ? '#374151' : '#e5e7eb' }}>
                  <Text className={textColor}>{t('discover.report')}</Text>
                </Pressable>
                <Pressable onPress={handleBlock} className="rounded-full px-4 py-2" style={{ backgroundColor: isDark ? '#374151' : '#e5e7eb' }}>
                  <Text className={textColor}>{t('discover.block')}</Text>
                </Pressable>
              </View>
            )}
            <View className="flex-row justify-center gap-4">
              <Pressable onPress={toggleMute} className={`w-14 h-14 rounded-full items-center justify-center ${isMuted ? 'bg-red-500' : isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
                <Feather name={isMuted ? 'mic-off' : 'mic'} size={20} color={isMuted ? 'white' : iconColor} />
              </Pressable>
              {!isVideoCall && (
                <Pressable onPress={toggleSpeaker} className={`w-14 h-14 rounded-full items-center justify-center ${isSpeakerEnabled ? 'bg-[#337E84]' : isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
                  <Ionicons name={isSpeakerEnabled ? "volume-high" : "volume-low"} size={20} color={isSpeakerEnabled ? 'white' : iconColor} />
                </Pressable>
              )}
              {isVideoCall && (
                <>
                  <Pressable onPress={toggleVideo} className={`w-14 h-14 rounded-full items-center justify-center ${!isVideoEnabled ? 'bg-red-500' : isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
                    <Feather name={isVideoEnabled ? 'video' : 'video-off'} size={20} color={!isVideoEnabled ? 'white' : iconColor} />
                  </Pressable>
                  <Pressable onPress={switchCamera} className={`w-14 h-14 rounded-full items-center justify-center ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
                    <Ionicons name="camera-reverse" size={20} color={iconColor} />
                  </Pressable>
                </>
              )}
              {isRandom && (
                <Pressable onPress={handleNextStranger} className="w-14 h-14 rounded-full items-center justify-center" style={{ backgroundColor: '#337E84' }}>
                  <Feather name="skip-forward" size={20} color="white" />
                </Pressable>
              )}
              <Pressable onPress={() => { weJustEndedRef.current = true; handleEndCall(); }} className="w-14 h-14 rounded-full bg-red-500 items-center justify-center">
                <Ionicons name="call" size={20} color="white" />
              </Pressable>
            </View>
          </>
        )}

        {callStatus === 'ringing' && (isCaller || isRandom) && (
          <View className="flex-row justify-center">
            <Pressable onPress={() => handleEndCall()} className="w-14 h-14 rounded-full bg-red-500 items-center justify-center">
              <Ionicons name="call" size={20} color="white" />
            </Pressable>
          </View>
        )}
      </View>
    </Screen>
  );
};

export default CallScreen;

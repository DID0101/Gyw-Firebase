import { Feather, Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, StatusBar, Text, Vibration, View } from 'react-native';
import InCallManager from 'react-native-incall-manager';

// Conditional import for react-native-webrtc (requires dev build)
import { RTCPeerConnection, RTCView, isWebRTCAvailable } from '@/lib/webrtc-wrapper';

import OutgoingCallWaiting from '@/components/calls/OutgoingCallWaiting';
import PreviewAvatar from '@/components/PreviewAvatar';
import Screen from '@/components/Screen';
import ScreenLoading from '@/components/ScreenLoading';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { app, functions, httpsCallable } from '@/lib/firebase';
import { blockUser, reportUser } from '@/lib/services/blockReportService';
import {
  endCallSession,
  getCall,
  subscribeToCall,
  updateCallReceiverReady,
  updateCallStatus,
  waitForReceiverReady,
} from '@/lib/services/callService';
import { presentMissedCallLocalNotification } from '@/lib/call/missedCallNotification';
import { releaseIncomingCall } from '@/lib/call/incomingCallGuard';
import { useCallManagerStore } from '@/store/callManagerStore';
import { useCallStore, type IncomingCallStoreData } from '@/store/callStore';
import { useCallSessionStore } from '@/store/callSessionStore';
import { getUser } from '@/lib/services/chatService';
import { useNetworkState } from '@/lib/networkState';
import { callLatencyMark } from '@/lib/perf/callLatencyTrace';
import {
  acceptFlowLog,
  acceptFlowLogCalleeSnapshot,
  acceptFlowLogCallerSnapshot,
} from '@/lib/call/acceptFlowTrace';
import { CALLEE_ACCEPT_GRACE_MS, callNavTrace } from '@/lib/call/callNavTrace';
import { videoCallTrace } from '@/lib/call/videoCallTrace';
import { runOnceByKey } from '@/lib/safeAction';
import { hasOfferBeenSent, webRTCService } from '@/lib/services/webrtcService';
import { Call } from '@/lib/types/call';
import { resolveDisplayName } from '@/lib/contacts/contactResolver';
import { useContactsStore } from '@/store/contactsStore';
import { User } from '@/lib/types/chat';

type OutgoingCallPhase =
  | 'waiting_for_doc'
  | 'ringing'
  | 'connecting'
  | 'active'
  | 'ended';

function normalizeCallTypeParam(
  param: string | string[] | undefined,
): 'audio' | 'video' | null {
  const s = Array.isArray(param) ? param[0] : param;
  if (s === 'video') return 'video';
  if (s === 'audio') return 'audio';
  return null;
}

function mediaTypeFromCall(call: Call | null): 'audio' | 'video' | null {
  if (!call) return null;
  const raw = call.type ?? (call as Call & { callType?: string }).callType;
  if (raw === 'video') return 'video';
  return 'audio';
}

const REMOTE_STREAM_POLL_MS = Platform.OS === 'android' ? 450 : 300;

function startRemoteStreamPoller(
  intervalRef: MutableRefObject<ReturnType<typeof setInterval> | null>,
  lastUrlRef: MutableRefObject<string | null>,
  setRemote: (stream: unknown) => void,
): void {
  if (intervalRef.current) clearInterval(intervalRef.current);
  intervalRef.current = setInterval(() => {
    const remote = webRTCService.getRemoteStream();
    if (!remote || remote.getTracks().length === 0) return;
    const url = remote.toURL?.() ?? '';
    if (!url || url === lastUrlRef.current) return;
    lastUrlRef.current = url;
    setRemote(remote);
  }, REMOTE_STREAM_POLL_MS);
}

function userFromIncomingPayload(incoming: IncomingCallStoreData): User {
  return {
    uid: incoming.callerId,
    displayName: incoming.callerName,
    photoURL: incoming.callerAvatar,
  } as User;
}

/** Prevents duplicate accept navigation from tearing down an active WebRTC session. */
const activeCallScreens = new Map<string, number>();

const CallScreen = () => {
  const {
    id: callId,
    accept: acceptParam,
    decline: declineParam,
    callType: callTypeParam,
    targetUserId: targetUserIdParam,
    isOutgoing: isOutgoingParam,
    chatId: chatIdParam,
  } = useLocalSearchParams<{
    id: string;
    accept?: string;
    decline?: string;
    callType?: string;
    targetUserId?: string;
    isOutgoing?: string;
    chatId?: string;
  }>();
  const isOutgoingFlow =
    isOutgoingParam === 'true' || isOutgoingParam === '1';
  const targetUserId = Array.isArray(targetUserIdParam)
    ? targetUserIdParam[0]
    : targetUserIdParam;
  const routeChatId = Array.isArray(chatIdParam) ? chatIdParam[0] : chatIdParam;
  const contactsRevision = useContactsStore((s) => s.revision);
  const paramCallType = normalizeCallTypeParam(callTypeParam);
  const [resolvedCallType, setResolvedCallType] = useState<'audio' | 'video' | null>(
    paramCallType,
  );
  const { user } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const { colorScheme, isDark } = useTheme();
  const { isOnline: networkOnline, isSlow: networkSlow } = useNetworkState();
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';
  
  const [call, setCall] = useState<Call | null>(null);
  const [otherUser, setOtherUser] = useState<User | null>(null);
  const [callStatus, setCallStatus] = useState<Call['status']>('ringing');
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerEnabled, setIsSpeakerEnabled] = useState(true);
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [isPassiveScreenInstance, setIsPassiveScreenInstance] = useState(false);
  const isPrimaryScreenRef = useRef(true);
  const [loading, setLoading] = useState(
    () => !isOutgoingFlow && acceptParam !== '1',
  );
  const [callPhase, setCallPhase] = useState<OutgoingCallPhase>(
    isOutgoingFlow ? 'waiting_for_doc' : 'ringing',
  );
  const [callActionBusy, setCallActionBusy] = useState(false);
  const [isCaller, setIsCaller] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  
  const callStartTime = useRef<number>(0);
  const callRingStartTime = useRef<number>(0);
  const durationInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const missedCallTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteStreamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRemoteStreamUrlRef = useRef<string | null>(null);
  const initializedRef = useRef<string | null>(null);
  const callStateRef = useRef<Call | null>(null);
  const isNavigatingAwayRef = useRef(false);
  const weJustEndedRef = useRef(false);
  const hasHandledEndRef = useRef(false);
  const iceFailureDetectedRef = useRef(false);
  const missedNotifShownRef = useRef(false);
  const ringVibrateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const incomingTriggerLoggedRef = useRef(false);
  const handledDeclineDeepLinkRef = useRef(false);
  const handledAcceptDeepLinkRef = useRef(false);
  const outgoingWebRtcStartedRef = useRef(false);
  const webrtcInitForCallRef = useRef<string | null>(null);
  const outgoingDocPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const acceptGraceUntilRef = useRef(0);

  const textColor = isDark ? 'text-white' : 'text-black';
  const bgColor = isDark ? 'bg-gray-900' : 'bg-white';

  const beginCalleeAcceptGrace = useCallback(() => {
    acceptGraceUntilRef.current = Date.now() + CALLEE_ACCEPT_GRACE_MS;
  }, []);

  const isInCalleeAcceptGrace = useCallback(
    () =>
      acceptParam === '1' &&
      Date.now() < acceptGraceUntilRef.current,
    [acceptParam],
  );

  const safeBack = (reason: string, opts?: { disconnected?: boolean }) => {
    if (isInCalleeAcceptGrace()) {
      callNavTrace('CALL_SAFE_BACK_BLOCKED', callId, { reason });
      return;
    }
    if (isNavigatingAwayRef.current) return;
    isNavigatingAwayRef.current = true;
    callNavTrace('CALL_SAFE_BACK_TRIGGER', callId, { reason, disconnected: opts?.disconnected ?? false });
    acceptFlowLog('CALL_ACCEPT_NAVIGATION_FAILED', callId, {
      reason: `safeBack:${reason}`,
      note: 'callee_returned_to_chats',
    });
    void useCallSessionStore.getState().reset();
    const current = callStateRef.current;
    const isRandom = current?.isRandom === true;
    const path = isRandom
      ? `/(home)/(tabs)/discover${opts?.disconnected ? '?disconnected=1' : ''}`
      : '/(home)/(tabs)/chats';
    router.replace(path as any);
  };

  useEffect(() => {
    callStateRef.current = call;
  }, [call]);

  /** Paint caller/callee shell from Zustand before Firestore getCall returns (Android accept path). */
  useLayoutEffect(() => {
    if (!callId) return;
    const incoming = useCallStore.getState().incomingCall;
    const active = useCallStore.getState().activeCall;
    if (incoming?.callId === callId) {
      if (!paramCallType) {
        setResolvedCallType((prev) => prev ?? incoming.callType);
      }
      setOtherUser((prev) => prev ?? userFromIncomingPayload(incoming));
      if (acceptParam === '1') {
        setLoading(false);
      }
    }
    if (active?.id === callId) {
      setCall((prev) => prev ?? active);
      setCallStatus(active.status);
      if (acceptParam === '1') {
        setLoading(false);
      }
    }
  }, [callId, acceptParam, paramCallType]);

  useEffect(() => {
    if (!callId) return;
    isPrimaryScreenRef.current = true;
    const count = (activeCallScreens.get(callId) ?? 0) + 1;
    activeCallScreens.set(callId, count);
    if (count > 1) {
      isPrimaryScreenRef.current = false;
      setIsPassiveScreenInstance(true);
      if (__DEV__) {
        console.warn('[CallScreen] duplicate instance — passive (no WebRTC teardown)', callId);
      }
    } else {
      videoCallTrace('VIDEO_CALL_SCREEN_MOUNT', callId, { accept: acceptParam ?? null });
      callNavTrace('CALL_SCREEN_MOUNT', callId, { accept: acceptParam ?? null });
      acceptFlowLog('CALL_SCREEN_MOUNTED', callId, {
        accept: acceptParam ?? null,
        isPrimary: true,
      });
      acceptFlowLog('CALL_SCREEN_CALL_ID', callId, { acceptParam: acceptParam ?? null });
      if (acceptParam === '1') beginCalleeAcceptGrace();
    }
    return () => {
      const next = (activeCallScreens.get(callId) ?? 1) - 1;
      if (next <= 0) activeCallScreens.delete(callId);
      else activeCallScreens.set(callId, next);
      if (isPrimaryScreenRef.current && next <= 0) {
        callNavTrace('CALL_SCREEN_UNMOUNT', callId, { accept: acceptParam ?? null });
      }
    };
  }, [callId, acceptParam, beginCalleeAcceptGrace]);

  useEffect(() => {
    if (otherUser || !callId || !user?.uid || targetUserId) return;
    const incoming = useCallStore.getState().incomingCall;
    if (incoming?.callId === callId) {
      setOtherUser(userFromIncomingPayload(incoming));
      return;
    }
    void getCall(callId).then((loaded) => {
      if (!loaded) return;
      const remoteUid =
        loaded.callerId === user.uid ? loaded.receiverId : loaded.callerId;
      if (!remoteUid) return;
      void getUser(remoteUid).then((u) => {
        if (u) setOtherUser(u);
      });
    });
  }, [callId, targetUserId, user?.uid, otherUser]);

  useEffect(() => {
    if (!callId || !remoteStream?.toURL?.()) return;
    const url = remoteStream.toURL();
    if (!url) return;
    videoCallTrace('REMOTE_VIDEO_RENDERED', callId, {
      streamUrl: url.slice(0, 32),
      videoTracks: remoteStream.getVideoTracks?.()?.length ?? 0,
    });
  }, [callId, remoteStream]);

  useEffect(() => {
    if (resolvedCallType || paramCallType) return;
    const fromCall = mediaTypeFromCall(call);
    if (fromCall) {
      setResolvedCallType(fromCall);
      return;
    }
    const incoming = useCallStore.getState().incomingCall;
    if (incoming?.callId === callId) {
      setResolvedCallType(incoming.callType);
      return;
    }
    if (!callId) return;
    void getCall(callId).then((loaded) => {
      const t = mediaTypeFromCall(loaded);
      if (t) setResolvedCallType(t);
    });
  }, [callId, call, resolvedCallType, paramCallType]);

  useEffect(() => {
    if (__DEV__ && resolvedCallType) {
      console.log('[CALL] resolvedCallType:', resolvedCallType, {
        callTypeParam: paramCallType,
        callId,
        acceptParam,
      });
    }
  }, [resolvedCallType, paramCallType, callId, acceptParam]);

  useEffect(() => {
    // Reset per-call deep-link handling whenever we switch to a different call.
    handledDeclineDeepLinkRef.current = false;
    handledAcceptDeepLinkRef.current = false;
    webrtcInitForCallRef.current = null;
    outgoingWebRtcStartedRef.current = false;
    lastRemoteStreamUrlRef.current = null;
    initializedRef.current = null;
  }, [callId]);

  useEffect(() => {
    if (!callId) return;
    useCallSessionStore.getState().setActiveSessionCallId(callId);
    return () => {
      if (useCallSessionStore.getState().activeSessionCallId === callId) {
        useCallSessionStore.getState().setActiveSessionCallId(null);
      }
    };
  }, [callId]);

  useFocusEffect(
    useCallback(() => {
      StatusBar.setHidden(true, 'fade');
      return () => {
        StatusBar.setHidden(false, 'fade');
      };
    }, [])
  );

  // Accept from native ANSWER_CALL / autoAccept — skip incoming UI, run callee accept + WebRTC
  useEffect(() => {
    if (acceptParam !== '1') return;
    if (!user || !callId) return;
    if (handledAcceptDeepLinkRef.current) return;

    const isOfferer = call
      ? call.isRandom === true
        ? user.uid === (call.callerId < call.receiverId ? call.callerId : call.receiverId)
        : call.callerId === user.uid
      : false;

    if (isOfferer && call && !call.isRandom) return;

    if (
      call &&
      !['ringing', 'accepted', 'answered', 'connecting', 'active'].includes(call.status)
    ) {
      return;
    }

    handledAcceptDeepLinkRef.current = true;
    beginCalleeAcceptGrace();
    callNavTrace('CALL_ACCEPT_PRESSED', callId, {
      status: call?.status ?? null,
      platform: Platform.OS,
    });

    void (async () => {
      const runAccept = async (callData: Call) => {
        await runOnceByKey(
          `accept_call:${callId}`,
          () => doAcceptCall(callData, otherUser),
          { debounceMs: 15000, logLabel: 'accept_call_deep_link', blockedLog: 'CALL_DUPLICATE_PREVENTED' },
        );
      };
      if (call) {
        await runAccept(call);
      } else {
        try {
          const cached = useCallStore.getState().activeCall;
          const loaded =
            cached?.id === callId ? cached : await getCall(callId);
          if (loaded) await runAccept(loaded);
        } catch (e) {
          if (__DEV__) console.warn('[CALL] accept=1 before call loaded failed', e);
        }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptParam, callId, call, callStatus, user?.uid, otherUser]);

  // Handle Decline deep-link (notification / lockscreen / full-screen system UI decline).
  // This path exists so the caller stops ringing even when the app process was dead.
  useEffect(() => {
    if (declineParam !== '1') return;
    if (handledDeclineDeepLinkRef.current) return;
    if (!callId || !user) return;
    if (!call) return;
    if (call.status !== 'ringing') return;
    if (call.isRandom) return; // for random, rely on normal timeout/end state sync

    // Callee should be the current user on non-random calls.
    if (call.receiverId !== user.uid) return;

    handledDeclineDeepLinkRef.current = true;
    console.log('CALL_DECLINE source=deep_link_declineParam callId=' + callId);

    void (async () => {
      try {
        await updateCallStatus(callId, 'declined', undefined, call.chatId);
        console.log('CALL_DB_UPDATE status=declined callId=' + callId);
        releaseIncomingCall(callId, 'declined_deep_link');
      } catch (e) {
        console.warn('CALL_DECLINE deep_link update failed', e);
      } finally {
        safeBack('decline_deep_link');
      }
    })();
  }, [declineParam, callId, user?.uid, callStatus, call]);

  useEffect(() => {
    if (!__DEV__) return;
    const { debugSessionLog } = require('@/lib/debugSessionLog');
    debugSessionLog(
      'call/[id]/index.tsx',
      'call_screen_mount',
      {
        callId,
        acceptParam: acceptParam ?? null,
        declineParam: declineParam ?? null,
        callTypeParam: callTypeParam ?? null,
        isOutgoingFlow,
        targetUserId: targetUserId ?? null,
        selfUid: user?.uid ?? null,
      },
      'B',
    );
  }, [callId, acceptParam, declineParam, callTypeParam, isOutgoingFlow, targetUserId, user?.uid]);

  // Do NOT include targetUserId in deps — when it resolves, React would run this
  // effect's cleanup and destroy the PeerConnection mid-call (stuck on "Connecting").
  useEffect(() => {
    if (!callId || !user || isPassiveScreenInstance) return;

    if (initializedRef.current === callId) {
      return;
    }
    initializedRef.current = callId;

    console.log('Initializing CallScreen for:', callId);

    const loadCall = async () => {
      try {
        if (isOutgoingFlow) {
          setLoading(false);
          setIsCaller(true);
          useCallManagerStore.getState().setActiveCallId(callId);
          if (targetUserId) {
            void getUser(targetUserId).then((otherUserData) => {
              if (otherUserData) setOtherUser(otherUserData);
            });
          }
          let attempts = 0;
          outgoingDocPollRef.current = setInterval(async () => {
            attempts += 1;
            const data = await getCall(callId);
            if (data) {
              if (outgoingDocPollRef.current) {
                clearInterval(outgoingDocPollRef.current);
                outgoingDocPollRef.current = null;
              }
            } else if (attempts > 10) {
              if (outgoingDocPollRef.current) {
                clearInterval(outgoingDocPollRef.current);
                outgoingDocPollRef.current = null;
              }
              setCallPhase('ended');
              Alert.alert(t('common.error'), t('messages.failedToStartAudioCall'));
              safeBack('outgoing_doc_poll_failed');
            }
          }, 500);
          return;
        }

        const cachedActive = useCallStore.getState().activeCall;
        const callData =
          cachedActive?.id === callId ? cachedActive : await getCall(callId);
        if (!callData) {
          Alert.alert(t('common.error'), t('call.sessionNotFound'));
          safeBack('load_call_not_found');
          return;
        }

        if (['ended', 'missed', 'declined', 'rejected', 'busy', 'canceled', 'timeout'].includes(callData.status)) {
          setCall(callData);
          setCallStatus(callData.status);
          setLoading(false);
          if (!isInCalleeAcceptGrace()) {
            setTimeout(() => safeBack('load_call_already_terminal'), 1500);
          }
          return;
        }

        setCall(callData);
        setCallStatus(callData.status);
        const otherUserId = callData.callerId === user.uid ? callData.receiverId : callData.callerId;
        const incoming = useCallStore.getState().incomingCall;
        if (incoming?.callId === callId) {
          setOtherUser((prev) => prev ?? userFromIncomingPayload(incoming));
        }
        setLoading(false);
        void getUser(otherUserId).then((otherUserData) => {
          if (otherUserData) setOtherUser(otherUserData);
        });

        const isCalleeRinging =
          !callData.isRandom &&
          callData.receiverId === user.uid &&
          callData.status === 'ringing';
        if (isCalleeRinging) {
          const activeId = useCallSessionStore.getState().activeSessionCallId;
          if (activeId && activeId !== callId) {
            try {
              await updateCallStatus(callId, 'busy');
            } catch {
              /* ignore */
            }
            Alert.alert(t('calls.callEnded'), t('calls.busyLine'));
            safeBack('callee_busy_other_session');
            return;
          }
        }

        // For random calls: deterministic offerer (smaller UID creates offer) to prevent offer collision
        const isRandom = callData.isRandom === true;
        const offererId = callData.callerId < callData.receiverId ? callData.callerId : callData.receiverId;
        const answererId = callData.callerId < callData.receiverId ? callData.receiverId : callData.callerId;
        const isOfferer = isRandom ? user.uid === offererId : callData.callerId === user.uid;
        setIsCaller(isOfferer);

        if (!isWebRTCAvailable || !RTCView || !RTCPeerConnection) {
          Alert.alert(t('common.error'), t('call.webrtcNotAvailable'));
          safeBack('webrtc_unavailable');
          return;
        }

        // Set up missed call timeout (20-25s for random, 30s for regular)
        if (callData.status === 'ringing') {
          callRingStartTime.current = Date.now();
          const timeoutMs = callData.isRandom ? 60000 : 30000;
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

        // iOS only: play ringtone + vibration from JS while waiting for callee to accept.
        // Android: GywIncomingCallAlerts (native) already owns ring + vibration;
        //          calling InCallManager.startRingtone() here would double-ring.
        if (!isOfferer && !isRandom && callData.status === 'ringing' && acceptParam !== '1' && Platform.OS !== 'android') {
          try {
            InCallManager.startRingtone('_BUNDLE_', 0, '', -1);
          } catch {
            try { InCallManager.startRingtone('_DEFAULT_', 0, '', -1); } catch { /* ignore */ }
          }
          try {
            if (ringVibrateIntervalRef.current) {
              clearInterval(ringVibrateIntervalRef.current);
              ringVibrateIntervalRef.current = null;
            }
            Vibration.vibrate([0, 500, 250, 500]);
            ringVibrateIntervalRef.current = setInterval(() => {
              Vibration.vibrate(600);
            }, 2200);
          } catch {
            /* ignore */
          }
        }

        if (isOfferer) {
          webRTCService.prepareForCall(callId);
          void initializeWebRTC(callData, otherUserId, isOfferer, offererId, answererId);
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
          void (async () => {
            await webRTCService.initializePeerConnection(callId);
            InCallManager.start({ media: callData.type === 'video' ? 'video' : 'audio' });
            InCallManager.setSpeakerphoneOn(callData.type === 'video');
            const stream = await webRTCService.requestLocalStream(
              callId,
              callData.type === 'video' ? 'video' : 'audio',
            );
            setLocalStream(stream);
            await updateCallReceiverReady(callId);
          })();
        }
        // Regular callee: no signaling / peer connection until Accept (or ConnectionService answer → accept=1)

        // accept=1 WebRTC is handled only by the dedicated effect below (avoids double accept).
        if (isRandom && callData.status === 'ringing') {
          void doAcceptCall(callData, otherUser ?? null);
        }
      } catch (error) {
        console.error('loadCall Error:', error);
        safeBack('load_call_error');
      } finally {
        setLoading(false);
      }
    };

    const unsubscribe = subscribeToCall(callId, (callData) => {
      if (!callData) {
        if (!isOutgoingFlow && !isInCalleeAcceptGrace()) {
          safeBack('subscribe_call_doc_missing');
        } else if (__DEV__) {
          callNavTrace('CALL_SAFE_BACK_BLOCKED', callId, { reason: 'subscribe_call_doc_missing' });
        }
        return;
      }
      setCall(callData);
      setCallStatus(callData.status);
      callNavTrace('CALL_STATUS_SNAPSHOT', callId, {
        status: callData.status,
        selfUid: user?.uid ?? null,
      });
      if (callData.callerId === user?.uid) {
        acceptFlowLogCallerSnapshot(callId, callData.status, { isOutgoingFlow });
      } else if (callData.receiverId === user?.uid) {
        acceptFlowLogCalleeSnapshot(callId, callData.status, {
          acceptParam: acceptParam ?? null,
          isPassiveScreenInstance,
        });
      }
      acceptFlowLog('CALL_STATUS_CHANGED', callId, { status: callData.status });

      if (isOutgoingFlow && callData.callerId === user.uid) {
        setCallPhase((prev) => {
          if (
            ['ended', 'missed', 'declined', 'rejected', 'busy', 'canceled', 'timeout'].includes(
              callData.status,
            )
          ) {
            return 'ended';
          }
          if (callData.status === 'active') return 'active';
          if (['accepted', 'connecting'].includes(callData.status)) return 'connecting';
          if (prev === 'waiting_for_doc') return 'ringing';
          return prev;
        });

        if (
          !outgoingWebRtcStartedRef.current &&
          ['ringing', 'accepted', 'answered', 'connecting'].includes(callData.status) &&
          !callData.isRandom
        ) {
          if (['accepted', 'answered', 'connecting'].includes(callData.status)) {
            console.log('CALLER_CALL_STATE_CHANGED ' + callData.status + ' callId=' + callId);
            console.log('CALLER_STOP_RING_TRIGGERED callId=' + callId);
            try {
              InCallManager.stopRingtone();
            } catch {
              /* ignore */
            }
          }
          outgoingWebRtcStartedRef.current = true;
          const otherUserId =
            callData.callerId === user.uid ? callData.receiverId : callData.callerId;
          const offererId =
            callData.callerId < callData.receiverId ? callData.callerId : callData.receiverId;
          const answererId =
            callData.callerId < callData.receiverId ? callData.receiverId : callData.callerId;
          webRTCService.prepareForCall(callId);
          void initializeWebRTC(callData, otherUserId, true, offererId, answererId);
        }
        if (
          isOutgoingFlow &&
          callData.callerId === user.uid &&
          ['accepted', 'connecting', 'active'].includes(callData.status)
        ) {
          void webRTCService.flushPendingRemoteAnswerIfAny();
        }
      }
      if (
        callData.status === 'ringing' &&
        !incomingTriggerLoggedRef.current &&
        user?.uid &&
        callData.receiverId === user.uid
      ) {
        incomingTriggerLoggedRef.current = true;
        if (__DEV__) console.log(`INCOMING_TRIGGER source=firestore_listener callId=${callId} ts=${Date.now()}`);
      }

      // Start duration timer for the caller when receiver accepts
      if (callData.status === 'active' && callStartTime.current === 0) {
        callStartTime.current = Date.now();
        setCallDuration(0);
        if (durationInterval.current) clearInterval(durationInterval.current);
        durationInterval.current = setInterval(() => {
          if (callStartTime.current > 0) {
            setCallDuration(Math.floor((Date.now() - callStartTime.current) / 1000));
          }
        }, 1000);
        if (missedCallTimeoutRef.current) {
          clearTimeout(missedCallTimeoutRef.current);
          missedCallTimeoutRef.current = null;
        }
      }

      if (['ended', 'missed', 'declined', 'rejected', 'busy', 'canceled', 'timeout'].includes(callData.status)) {
        const isCalleeAccept =
          acceptParam === '1' &&
          callData.receiverId === user?.uid &&
          !callData.isRandom;
        if (isCalleeAccept && isInCalleeAcceptGrace()) {
          callNavTrace('CALL_TERMINAL_IGNORED_GRACE', callId, { status: callData.status });
          return;
        }
        callNavTrace('CALL_TERMINAL_EVENT', callId, { status: callData.status });
        releaseIncomingCall(callId, `terminal_${callData.status}`);
        console.log('CALLER_SNAPSHOT_STATUS=' + callData.status + ' callId=' + callId);
        console.log('CALLER_TERMINAL_RECEIVED status=' + callData.status + ' callId=' + callId);
        console.log('CALLER_RING_STOP callId=' + callId);
        // #region agent log
        try {
          const { debugSessionLog } = require('@/lib/debugSessionLog');
          debugSessionLog(
            'call/[id]/index.tsx:subscribeToCall',
            'call_terminal_status',
            {
              callId,
              status: callData.status,
              selfUid: user?.uid ?? null,
              callerId: callData.callerId,
              receiverId: callData.receiverId,
              isCaller: callData.callerId === user?.uid,
              isCallee: callData.receiverId === user?.uid,
            },
            'D',
          );
        } catch (_) {}
        // #endregion
        if (__DEV__) console.log('[CallScreen] call ended remotely', { status: callData.status, callId });
        if (
          callData.status === 'missed' &&
          callData.receiverId === user?.uid &&
          !callData.isRandom &&
          !missedNotifShownRef.current
        ) {
          missedNotifShownRef.current = true;
          void (async () => {
            try {
              const caller = await getUser(callData.callerId);
              const name = caller
                ? resolveDisplayName(
                    {
                      phoneNumber: caller.phoneNumber,
                      firstName: caller.firstName,
                      lastName: caller.lastName,
                      username: caller.username,
                      displayName: caller.displayName,
                    },
                    { fallback: 'Unknown', logContext: 'missed_call_notif', preferLiveProfile: true }
                  )
                : 'Unknown';
              await presentMissedCallLocalNotification({
                callId,
                callerName: name,
                isVideo: callData.type === 'video' || (callData as any).callType === 'video',
              });
            } catch {
              /* ignore */
            }
          })();
        }
        const strangerLeft = callData.isRandom && !weJustEndedRef.current;
        callNavTrace('CALL_EXIT_REASON', callId, { reason: 'terminal_snapshot', status: callData.status });
        handleEndCall(callData, strangerLeft);
      }
    });

    loadCall();

    return () => {
      const screensLeft = (activeCallScreens.get(callId) ?? 1) - 1;
      unsubscribe();
      if (outgoingDocPollRef.current) {
        clearInterval(outgoingDocPollRef.current);
        outgoingDocPollRef.current = null;
      }
      try { InCallManager.stopRingtone(); } catch { /* ignore */ }
      try {
        Vibration.cancel();
      } catch {
        /* ignore */
      }
      if (ringVibrateIntervalRef.current) {
        clearInterval(ringVibrateIntervalRef.current);
        ringVibrateIntervalRef.current = null;
      }
      InCallManager.stop();

      if (isPrimaryScreenRef.current && screensLeft <= 0) {
        const cleanupId = callId;
        setTimeout(() => {
          if ((activeCallScreens.get(cleanupId) ?? 0) > 0) {
            if (__DEV__) {
              console.log('[CallScreen] skip cleanup — screen remounted', cleanupId);
            }
            return;
          }
          callNavTrace('CALL_CLEANUP_TRIGGER', cleanupId, { screensLeft: 0 });
          webRTCService.cleanup(cleanupId);
          webRTCService.setOnAnswerReady(null);
          webRTCService.setOnMediaConnected(null);
        }, 500);
      }

      void useCallSessionStore.getState().reset();
      if (durationInterval.current) clearInterval(durationInterval.current);
      if (missedCallTimeoutRef.current) clearTimeout(missedCallTimeoutRef.current);
      if (remoteStreamIntervalRef.current) clearInterval(remoteStreamIntervalRef.current);
    };
  }, [callId, user?.uid, isOutgoingFlow, isPassiveScreenInstance]);

  const initializeWebRTC = async (
    callData: Call,
    otherUserId: string,
    isOfferer: boolean,
    offererId?: string,
    answererId?: string
  ) => {
    if (webrtcInitForCallRef.current === callId) {
      if (__DEV__) console.log('[CALL] WebRTC init already completed for', callId);
      return;
    }
    webrtcInitForCallRef.current = callId;

    try {
      const mediaType =
        resolvedCallType ??
        mediaTypeFromCall(callData) ??
        normalizeCallTypeParam(callTypeParam) ??
        'audio';
      const isVideoCall = mediaType === 'video';
      const withCamera = useCallSessionStore.getState().pendingAnswerWithCamera;
      useCallSessionStore.getState().clearPendingAnswerWithCamera();
      setIsVideoEnabled(isVideoCall);
      setIsSpeakerEnabled(isVideoCall);

      InCallManager.start({ media: isVideoCall ? 'video' : 'audio' });
      InCallManager.setSpeakerphoneOn(isVideoCall);

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

      if (webRTCService.hasPreparedMedia(callId)) {
        const prepared = webRTCService.getLocalStream();
        if (prepared) setLocalStream(prepared);
        if (__DEV__) console.log('[CALL] reusing prepared local stream', callId);
      }
      const stream = await webRTCService.requestLocalStream(callId, mediaType);
      setLocalStream(stream);

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
      if (isOfferer) {
        await webRTCService.hydratePendingSignaling(callId, user!.uid, otherUserId, true);
        await webRTCService.flushPendingRemoteAnswerIfAny();
      }

      // Regular calls: offer is sent once from initiateCall → finalizeOutgoingOfferAndNotify.
      if (callData.isRandom && isOfferer && offererId && answererId) {
        await waitForReceiverReady(callId, 8000);
        if (!hasOfferBeenSent(callId)) {
          await webRTCService.createAndSendOffer(callId, offererId, answererId);
        }
      } else if (isOfferer && !callData.isRandom && !hasOfferBeenSent(callId)) {
        if (__DEV__) {
          console.log('[CALL] caller: waiting for initiateCall to send offer', callId);
        }
      }

      startRemoteStreamPoller(
        remoteStreamIntervalRef,
        lastRemoteStreamUrlRef,
        setRemoteStream,
      );

    } catch (error: any) {
      console.error('initializeWebRTC Error:', error);
      // Don't alert for context-switch - user navigated to different call
      if (error?.message?.includes('context switched')) {
        return;
      }
      Alert.alert(t('call.mediaError'), t('call.couldNotAccessCameraMic'));
      safeBack('initialize_webrtc_error');
    }
  };

  const promotedToActiveRef = useRef(false);

  const promoteCallToActive = useCallback(async () => {
    if (promotedToActiveRef.current) return;
    promotedToActiveRef.current = true;
    try {
      await updateCallStatus(callId, 'active');
      setCallStatus('active');
      acceptGraceUntilRef.current = 0;
      callNavTrace('CALL_SESSION_ACTIVE', callId, {});
      console.log('WEBRTC_CONNECTED callId=' + callId);
      if (!callStartTime.current) callStartTime.current = Date.now();
    } catch (e) {
      promotedToActiveRef.current = false;
      console.error('[CALL] promoteCallToActive failed', e);
    }
  }, [callId]);

  const doAcceptCall = async (callData: Call, _otherUserData: User | null) => {
    if (!user || isPassiveScreenInstance) {
      acceptFlowLog('DO_ACCEPT_CALL_START', callId, {
        skipped: true,
        reason: isPassiveScreenInstance ? 'passive_screen' : 'no_user',
      });
      return;
    }
    acceptFlowLog('DO_ACCEPT_CALL_START', callId, { status: callData.status });
    beginCalleeAcceptGrace();
    const { markCallAccepted } = await import('@/lib/call/incomingCallGuard');
    markCallAccepted(callId, 'doAcceptCall');
    useCallManagerStore.getState().markCalleeAnswered(callId);
    acceptFlowLog('ACCEPT_CLICKED', callId, { status: callData.status, mediaType: 'pending' });
    acceptFlowLog('CALL_STATUS_BEFORE_ACCEPT', callId, { status: callData.status });
    promotedToActiveRef.current = false;
    webRTCService.setOnAnswerReady(() => {
      void promoteCallToActive();
    });
    webRTCService.setOnMediaConnected(() => {
      void promoteCallToActive();
    });
    try {
      webRTCService.prepareForCall(callId);
      const mediaType =
        resolvedCallType ??
        mediaTypeFromCall(callData) ??
        normalizeCallTypeParam(callTypeParam) ??
        'audio';
      videoCallTrace('VIDEO_ACCEPT_START', callId, {
        mediaType,
        status: callData.status,
        callee: callData.receiverId === user.uid,
      });
      const isVideoCall = mediaType === 'video';
      const withCamera = useCallSessionStore.getState().pendingAnswerWithCamera;
      useCallSessionStore.getState().clearPendingAnswerWithCamera();
      setIsVideoEnabled(isVideoCall);
      const otherUserId = callData.callerId === user.uid ? callData.receiverId : callData.callerId;
      const isRegularCallee = !callData.isRandom && callData.receiverId === user.uid;

      setIsSpeakerEnabled(isVideoCall);
      try {
        InCallManager.stopRingtone();
      } catch {
        /* ignore */
      }
      try {
        Vibration.cancel();
      } catch {
        /* ignore */
      }
      if (ringVibrateIntervalRef.current) {
        clearInterval(ringVibrateIntervalRef.current);
        ringVibrateIntervalRef.current = null;
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
        await webRTCService.hydratePendingSignaling(callId, user.uid, otherUserId, false);
        try {
          InCallManager.start({ media: isVideoCall ? 'video' : 'audio' });
          InCallManager.setSpeakerphoneOn(isVideoCall);
        } catch {
          /* ignore */
        }
        const stream = await webRTCService.requestLocalStream(callId, mediaType);
        setLocalStream(stream);
        videoCallTrace('LOCAL_STREAM_CREATED', callId, {
          audio: stream.getAudioTracks().length,
          video: stream.getVideoTracks().length,
        });
      } else {
        InCallManager.start({ media: isVideoCall ? 'video' : 'audio' });
        InCallManager.setSpeakerphoneOn(isVideoCall);
        const stream = callData.isRandom
          ? webRTCService.getLocalStream()
          : await webRTCService.requestLocalStream(callId, mediaType);
        if (stream) setLocalStream(stream);
      }

      if (callData.status === 'ringing') {
        acceptFlowLog('ACCEPT_FIRESTORE_UPDATE_START', callId, { nextStatus: 'accepted' });
        void updateCallStatus(callId, 'accepted')
          .then(() => {
            acceptFlowLog('ACCEPT_FIRESTORE_UPDATE_SUCCESS', callId, { status: 'accepted' });
            acceptFlowLog('CALL_STATUS_AFTER_ACCEPT', callId, { status: 'accepted' });
          })
          .catch((e) => {
            acceptFlowLog('ACCEPT_FIRESTORE_UPDATE_FAILED', callId, { error: String(e) });
          });
        console.log('CALL_DB_UPDATE status=accepted callId=' + callId);
      }
      callNavTrace('CALL_RELEASE_TRIGGER', callId, { reason: 'accepted' });
      releaseIncomingCall(callId, 'accepted');
      setCallStatus('accepted' as Call['status']);
      callNavTrace('CALL_STATE_LOCAL', callId, { status: 'accepted' });

      callLatencyMark(callId, 'ACCEPT_CLICKED');
      console.log('WEBRTC_LOCAL_STREAM_READY callId=' + callId);

      let answerSent = await webRTCService.trySendAnswerWhenReady();
      for (let attempt = 0; !answerSent && attempt < 50; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 200));
          if (attempt % 5 === 0) {
            await webRTCService.hydratePendingSignaling(callId, user.uid, otherUserId, false);
          }
        }
        answerSent = await webRTCService.trySendAnswerWhenReady();
      }

      if (answerSent) {
        console.log('WEBRTC_ANSWER_READY callId=' + callId);
        await promoteCallToActive();
      } else {
        console.warn('[CALL] accept: waiting for caller offer via signaling', callId);
        setCallStatus('accepted' as Call['status']);
      }

      if (missedCallTimeoutRef.current) {
        clearTimeout(missedCallTimeoutRef.current);
        missedCallTimeoutRef.current = null;
      }

      // Clear any intervals already running (e.g. from initializeWebRTC for random offerer)
      if (remoteStreamIntervalRef.current) clearInterval(remoteStreamIntervalRef.current);
      if (durationInterval.current) clearInterval(durationInterval.current);

      startRemoteStreamPoller(
        remoteStreamIntervalRef,
        lastRemoteStreamUrlRef,
        setRemoteStream,
      );

      setCallDuration(0);
      durationInterval.current = setInterval(() => {
        if (callStartTime.current > 0) {
          setCallDuration(Math.floor((Date.now() - callStartTime.current) / 1000));
        }
      }, 1000);
    } catch (error) {
      console.error('Accept Error:', error);
    }
  };

  const handleAcceptCall = async () => {
    if (!call || !user || callStatus !== 'ringing' || callActionBusy) return;
    setCallActionBusy(true);
    try {
      await runOnceByKey(
        `accept_call:${callId}`,
        () => doAcceptCall(call, otherUser),
        { debounceMs: 5000, logLabel: 'accept_call', blockedLog: 'CALL_DUPLICATE_PREVENTED' }
      );
    } finally {
      setCallActionBusy(false);
    }
  };

  const handleRejectCall = async () => {
    const currentCall = callStateRef.current;
    if (!currentCall || callActionBusy) return;
    setCallActionBusy(true);
    try {
      await runOnceByKey(
        `decline_call:${callId}`,
        async () => {
          try {
            Vibration.cancel();
          } catch {
            /* ignore */
          }
          if (ringVibrateIntervalRef.current) {
            clearInterval(ringVibrateIntervalRef.current);
            ringVibrateIntervalRef.current = null;
          }
          void endCallSession(callId, 'declined', { chatId: currentCall.chatId });
          void (async () => {
            try {
              const { sendSignalingMessage } = await import('@/lib/services/callService');
              await sendSignalingMessage(
                callId,
                user!.uid,
                currentCall.receiverId === user!.uid
                  ? currentCall.callerId
                  : currentCall.receiverId,
                'hangup',
              );
            } catch {
              /* ignore */
            }
          })();
          safeBack('reject_call');
        },
        { debounceMs: 5000, logLabel: 'decline_call', blockedLog: 'CALL_DUPLICATE_PREVENTED' },
      );
    } catch (error) {
      console.error('Reject Error:', error);
      safeBack('reject_call_error');
    } finally {
      setCallActionBusy(false);
    }
  };

  const handleEndCall = async (terminalCall?: Call, strangerLeft?: boolean) => {
    if (hasHandledEndRef.current) return;
    const activeId = useCallManagerStore.getState().activeCallId;
    if (activeId && activeId !== callId) {
      if (__DEV__) {
        console.warn('[CallScreen] handleEndCall skip — stale screen', { callId, activeId });
      }
      return;
    }
    const currentCall = terminalCall || callStateRef.current;
    if (
      isInCalleeAcceptGrace() &&
      currentCall?.receiverId === user?.uid &&
      !currentCall?.isRandom
    ) {
      callNavTrace('CALL_END_BLOCKED_GRACE', callId, {
        status: currentCall?.status ?? null,
      });
      return;
    }
    hasHandledEndRef.current = true;
    if (!currentCall || !user) return;

    const dismissT0 = Date.now();
    try {
      Vibration.cancel();
    } catch {
      /* ignore */
    }
    try {
      InCallManager.stopRingtone();
      InCallManager.stop();
    } catch {
      /* ignore */
    }
    if (ringVibrateIntervalRef.current) {
      clearInterval(ringVibrateIntervalRef.current);
      ringVibrateIntervalRef.current = null;
    }
    if (remoteStreamIntervalRef.current) {
      clearInterval(remoteStreamIntervalRef.current);
      remoteStreamIntervalRef.current = null;
    }
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
      durationInterval.current = null;
    }

    const duration =
      callStartTime.current > 0
        ? Math.floor((Date.now() - callStartTime.current) / 1000)
        : 0;

    const alreadyTerminal = [
      'ended',
      'missed',
      'declined',
      'rejected',
      'busy',
      'canceled',
      'timeout',
    ].includes(currentCall.status);

    // Leave call screen immediately — teardown + Firestore run in parallel.
    safeBack('handle_end_call', strangerLeft ? { disconnected: true } : undefined);
    console.log('CALL_UI_DISMISS_MS', Date.now() - dismissT0);

    const reason =
      currentCall.status === 'ringing' && currentCall.callerId === user.uid
        ? 'cancelled'
        : 'ended';
    if (!alreadyTerminal) {
      endCallSession(callId, reason, {
        chatId: currentCall.chatId,
        duration,
        skipNativeDismiss: true,
      });
      void (async () => {
        try {
          const { sendSignalingMessage } = await import('@/lib/services/callService');
          await sendSignalingMessage(
            callId,
            user.uid,
            currentCall.callerId === user.uid
              ? currentCall.receiverId
              : currentCall.callerId,
            'hangup',
          );
        } catch {
          /* ignore */
        }
      })();
    } else {
      endCallSession(callId, 'ended', {
        chatId: currentCall.chatId,
        duration,
        skipNativeDismiss: true,
      });
    }
  };

  const handleNextStranger = async () => {
    if (!user?.uid) return;
    try {
      let allowed: boolean;
      if (Platform.OS === 'web') {
        const checkSkipFn = (httpsCallable as any)(functions, 'checkSkipRateLimit');
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

  const outgoingCalleeName = otherUser
    ? resolveDisplayName(
        {
          phoneNumber: otherUser.phoneNumber,
          firstName: otherUser.firstName,
          lastName: otherUser.lastName,
          username: otherUser.username,
          displayName: otherUser.displayName,
        },
        { fallback: 'User', logContext: 'outgoing_call', preferLiveProfile: true }
      )
    : 'User';
  const outgoingCallType: 'audio' | 'video' =
    resolvedCallType ?? (call?.type === 'video' ? 'video' : 'audio');

  if (
    isOutgoingFlow &&
    (callPhase === 'waiting_for_doc' || callPhase === 'ringing')
  ) {
    const statusMessage =
      callPhase === 'waiting_for_doc' ? t('calls.calling') : t('calls.ringing', { defaultValue: 'Ringing…' });
    return (
      <OutgoingCallWaiting
        calleeName={outgoingCalleeName}
        calleeAvatar={otherUser?.avatar}
        callType={outgoingCallType}
        message={statusMessage}
        onHangUp={() => {
          void (async () => {
            try {
              await endCallSession(callId, 'cancelled', {
                chatId: routeChatId || call?.chatId,
              });
            } catch (e) {
              if (__DEV__) console.warn('[CALL] cancel outgoing failed', e);
            } finally {
              if (router.canGoBack()) {
                callNavTrace('CALL_ROUTER_BACK_TRIGGER', callId, { reason: 'cancel_outgoing' });
                router.back();
              } else {
                safeBack('cancel_outgoing');
              }
            }
          })();
        }}
      />
    );
  }

  if (isPassiveScreenInstance) {
    return null;
  }

  if (loading) return <ScreenLoading />;

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const isRandom = call?.isRandom === true;
  const displayName = isRandom
    ? (otherUser?.firstName?.trim() || t('discover.stranger'))
    : otherUser
      ? resolveDisplayName(
          {
            phoneNumber: otherUser.phoneNumber,
            firstName: otherUser.firstName,
            lastName: otherUser.lastName,
            username: otherUser.username,
            displayName: otherUser.displayName,
          },
          { fallback: 'User', logContext: 'active_call', preferLiveProfile: true }
        )
      : 'User';
  const isVideoCall = resolvedCallType === 'video';
  const showRemoteVideo =
    isVideoCall &&
    !!remoteStream &&
    ['accepted', 'connecting', 'active'].includes(callStatus);
  const showLocalVideo =
    isVideoCall &&
    !!localStream &&
    (callStatus === 'active' ||
      callStatus === 'connecting' ||
      callStatus === 'accepted' ||
      (callStatus === 'ringing' && (isCaller || isRandom)));

  return (
    <Screen viewClassName={`flex-1 ${bgColor}`}>
      {showRemoteVideo && RTCView && remoteStream?.toURL?.() ? (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <RTCView
            key={`remote-${callId}`}
            streamURL={remoteStream.toURL()}
            objectFit="cover"
            style={{ flex: 1 }}
            zOrder={0}
          />
        </View>
      ) : null}

      {showLocalVideo && RTCView && localStream?.toURL?.() ? (
        <View
          className="absolute top-16 right-4 w-32 h-48 rounded-lg overflow-hidden border-2 border-white"
          style={{ zIndex: 10 }}
        >
          <RTCView
            key={`local-${callId}`}
            streamURL={localStream.toURL()}
            objectFit="cover"
            style={{ flex: 1 }}
            mirror
            zOrder={1}
          />
        </View>
      ) : null}

      {(!showRemoteVideo || !remoteStream) && (
        <View className="flex-1 items-center justify-center p-8">
          <PreviewAvatar name={displayName} image={otherUser?.avatar} size={120} fontSize={48} />
          <Text className={`text-2xl font-semibold mt-6 ${textColor}`}>{displayName}</Text>
          <Text className={`text-base mt-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            {callStatus === 'ringing'
              ? isRandom
                ? t('calls.connecting')
                : isCaller
                  ? t('calls.calling')
                  : isVideoCall
                    ? t('calls.incomingVideoCall')
                    : t('calls.incomingAudioCall')
              : callStatus === 'accepted' || callStatus === 'connecting'
                ? t('calls.connecting')
              : callStatus === 'active'
                ? !networkOnline
                  ? t('calls.reconnecting', { defaultValue: 'Reconnecting…' })
                  : networkSlow && callDuration > 0
                    ? `${formatDuration(callDuration)} • ${t('calls.poorConnection', { defaultValue: 'Poor connection' })}`
                    : callDuration > 0
                      ? formatDuration(callDuration)
                      : t('calls.connected')
                : t('calls.callEnded')}
          </Text>
        </View>
      )}

      <View className={`absolute bottom-0 left-0 right-0 p-6 ${bgColor} border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        {callStatus === 'ringing' && !isCaller && !isRandom && (
          <View className="flex-row justify-center gap-8 mb-4 items-center">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('calls.decline')}
              disabled={callActionBusy}
              onPress={handleRejectCall}
              className="w-20 h-20 rounded-full bg-red-500 items-center justify-center shadow-lg"
              style={{ elevation: 6, opacity: callActionBusy ? 0.55 : 1 }}
            >
              <Ionicons name="call" size={28} color="white" style={{ transform: [{ rotate: '135deg' }] }} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('calls.accept')}
              disabled={callActionBusy}
              onPress={handleAcceptCall}
              className="w-20 h-20 rounded-full bg-[#FF5722] items-center justify-center shadow-lg"
              style={{ elevation: 6, opacity: callActionBusy ? 0.55 : 1 }}
            >
              <Ionicons name="call" size={28} color="white" />
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
                <Pressable onPress={toggleSpeaker} className={`w-14 h-14 rounded-full items-center justify-center ${isSpeakerEnabled ? 'bg-[#FF5722]' : isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
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
                <Pressable onPress={handleNextStranger} className="w-14 h-14 rounded-full items-center justify-center" style={{ backgroundColor: '#FF5722' }}>
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

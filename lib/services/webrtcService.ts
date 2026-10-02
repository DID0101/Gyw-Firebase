// Conditional import for react-native-webrtc (requires dev build)
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStream,
  mediaDevices,
  isWebRTCAvailable,
} from '@/lib/webrtc-wrapper';
import { Platform } from 'react-native';

import { isLowTierAndroid } from '@/lib/perf/deviceProfile';
import {
  logPeerConnectionCreated,
  logPeerConnectionDestroyed,
  logWebrtcIceReconnect,
} from '@/lib/perf/productionTelemetry';
import { callLatencyMark } from '@/lib/perf/callLatencyTrace';
import { videoCallTrace } from '@/lib/call/videoCallTrace';
import {
  fetchPendingSignalingForCallee,
  sendSignalingMessage,
  subscribeToSignaling,
} from './callService';

function devLog(...args: unknown[]) {
  if (__DEV__) console.log(...args);
}
function devWarn(...args: unknown[]) {
  if (__DEV__) console.warn(...args);
}

export interface WebRTCCall {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  peerConnection: RTCPeerConnection | null;
  isCaller: boolean;
}

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function buildVideoConstraints(): Record<string, unknown> {
  if (Platform.OS === 'android' && isLowTierAndroid()) {
    return {
      facingMode: 'user',
      width: { ideal: 480 },
      height: { ideal: 360 },
      frameRate: { ideal: 20, max: 24 },
    };
  }
  return {
    facingMode: 'user',
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 24, max: 30 },
  };
}

let inflightOutgoingMediaPrep: Promise<void> | null = null;
let inflightOutgoingMediaPrepCallId: string | null = null;

/** Ensures exactly one offer is sent per callId (caller). */
const offerSentForCall = new Set<string>();

export function hasOfferBeenSent(callId: string): boolean {
  return offerSentForCall.has(callId);
}

export class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  /** Incoming-screen preview only — never attached to the peer connection. */
  private incomingPreviewStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private signalingUnsubscribe: (() => void) | null = null;
  private onRemoteStreamCallback?: (stream: any) => void;
  private onIceFailureCallback?: () => void;
  private pendingCallInfo: { callId: string; receiverId: string; callerId: string } | null = null;
  private remoteIceCandidatesQueue: any[] = [];
  private isProcessingRemoteDescription = false;
  private signalingConfig: { callId: string; userId: string; otherUserId: string } | null = null;
  private initializingPromise: Promise<RTCPeerConnection> | null = null;
  private currentCallId: string | null = null;
  private iceFailureCount = 0;
  private iceFailureTimeout: ReturnType<typeof setTimeout> | null = null;
  private mediaPrepCompleteForCallId: string | null = null;
  private creatingAnswerPromise: Promise<void> | null = null;
  private remoteOfferAppliedForCallId: string | null = null;
  private isProcessingOffer = false;
  private pendingRemoteAnswer: RTCSessionDescriptionInit | null = null;
  private onAnswerReadyCallback: (() => void) | null = null;
  private onMediaConnectedCallback: (() => void) | null = null;
  private static prewarmDone = false;

  setOnAnswerReady(callback: (() => void) | null): void {
    this.onAnswerReadyCallback = callback;
  }

  setOnMediaConnected(callback: (() => void) | null): void {
    this.onMediaConnectedCallback = callback;
  }

  private notifyAnswerReady(): void {
    try {
      this.onAnswerReadyCallback?.();
    } catch (err) {
      console.error('[WebRTC] onAnswerReady callback failed', err);
    }
  }

  private notifyMediaConnected(callId: string): void {
    try {
      this.onMediaConnectedCallback?.();
    } catch (err) {
      console.error('[WebRTC] onMediaConnected callback failed', err);
    }
    videoCallTrace('PC_CONNECTION_STATE', callId, { state: 'connected' });
  }

  private async flushPendingRemoteAnswer(): Promise<void> {
    if (!this.pendingRemoteAnswer) return;
    const answer = this.pendingRemoteAnswer;
    this.pendingRemoteAnswer = null;
    await this.handleAnswer(answer);
  }

  /** Caller: apply answer that arrived before local offer was ready. */
  async flushPendingRemoteAnswerIfAny(): Promise<void> {
    await this.flushPendingRemoteAnswer();
  }

  /** Load native WebRTC module early (app boot) — no camera/mic. */
  static prewarmEngine(): void {
    if (WebRTCService.prewarmDone || !isWebRTCAvailable || !RTCPeerConnection) return;
    WebRTCService.prewarmDone = true;
    try {
      // Touch constructors so JNI loads before first call.
      void RTCPeerConnection;
      void mediaDevices;
    } catch {
      WebRTCService.prewarmDone = false;
    }
  }

  async initializePeerConnection(callId: string): Promise<RTCPeerConnection> {
    console.log('WEBRTC_CREATE_PEER_START', { callId });
    if (!isWebRTCAvailable || !RTCPeerConnection) {
      throw new Error('WebRTC not available. Please rebuild the app with: npx expo prebuild --clean && npx expo run:android/ios');
    }
    
    // If we are already handling a DIFFERENT call, clean up the old one first
    if (this.currentCallId && this.currentCallId !== callId) {
      devLog('Switching WebRTC context from', this.currentCallId, 'to', callId);
      this.cleanup(this.currentCallId);
    }

    this.currentCallId = callId;

    // Prevent multiple simultaneous initializations
    if (this.initializingPromise) {
      devLog('PeerConnection initialization already in progress...');
      return this.initializingPromise;
    }

    if (this.peerConnection) {
      devLog('Returning existing PeerConnection for call:', callId);
      return this.peerConnection;
    }

    this.initializingPromise = (async () => {
      callLatencyMark(callId, 'WEBRTC_INIT_START');
      devLog('Initializing new RTCPeerConnection');
      const configuration = {
        iceServers: ICE_SERVERS,
        iceTransportPolicy: 'all' as const,
        bundlePolicy: 'max-bundle' as const,
        rtcpMuxPolicy: 'require' as const,
      };

      try {
        const pc = new RTCPeerConnection(configuration);
        this.peerConnection = pc;
        console.log('WEBRTC_CREATE_PEER_SUCCESS', { callId });
        logPeerConnectionCreated(callId);
        this.remoteIceCandidatesQueue = [];

        // Handle remote stream via ontrack
        pc.ontrack = (event: any) => {
          console.log('WEBRTC_REMOTE_TRACK_RECEIVED', {
            callId,
            kind: event.track?.kind,
            id: event.track?.id,
            streams: event.streams?.length ?? 0,
          });
          devLog('ontrack event received:', {
            streams: event.streams?.length || 0,
            track: event.track?.kind,
            trackId: event.track?.id,
          });
          
          let stream = event.streams && event.streams[0] ? event.streams[0] : null;
          
          if (!stream && event.track) {
            devLog('No stream in ontrack, ensuring track is enabled');
            if (!this.remoteStream) {
              this.remoteStream = new MediaStream();
            }
            this.remoteStream!.addTrack(event.track);
            stream = this.remoteStream;
          }

          if (stream) {
            this.remoteStream = stream;
            devLog('Remote stream updated, total tracks:', stream.getTracks().length);
            
            // Ensure all tracks are enabled
            stream.getTracks().forEach((track: any) => {
              track.enabled = true;
              devLog('Remote track enabled:', track.kind, track.id);
              if (track.kind === 'audio') {
                callLatencyMark(callId, 'REMOTE_AUDIO_ATTACHED');
              } else if (track.kind === 'video') {
                callLatencyMark(callId, 'REMOTE_VIDEO_ATTACHED');
              }
            });

            if (this.onRemoteStreamCallback) {
              // IMPORTANT: when tracks are added to the same MediaStream instance (audio first,
              // then video), React state may not re-render if the reference is unchanged.
              // Emit a fresh MediaStream snapshot so RTCView updates reliably.
              try {
                const snapshot = new MediaStream();
                stream.getTracks().forEach((t: any) => snapshot.addTrack(t));
                const v = snapshot.getVideoTracks?.()?.length ?? 0;
                const a = snapshot.getAudioTracks?.()?.length ?? 0;
                console.log('WEBRTC_REMOTE_STREAM_RECEIVED', { callId, audioTracks: a, videoTracks: v });
                snapshot.getVideoTracks?.()?.forEach((t: any) => {
                  t.enabled = true;
                  videoCallTrace('VIDEO_TRACK_ATTACHED', callId, { id: t.id, enabled: t.enabled });
                });
                this.onRemoteStreamCallback(snapshot);
                videoCallTrace('REMOTE_STREAM_RECEIVED', callId, {
                  audioTracks: a,
                  videoTracks: v,
                });
              } catch {
                this.onRemoteStreamCallback(stream);
              }
            }
          }
        };

        pc.onicecandidate = (event: any) => {
          if (!event.candidate || !this.signalingConfig) return;
          const { callId, userId, otherUserId } = this.signalingConfig;
          void sendSignalingMessage(
            callId,
            userId,
            otherUserId,
            'ice-candidate',
            undefined,
            event.candidate.toJSON(),
          ).then(() => {
            console.log('WEBRTC_SEND_ICE', { callId, from: userId });
            console.log('WEBRTC_ICE_LOCAL', { callId, from: userId });
            videoCallTrace('ICE_SENT', callId, { from: userId });
          }).catch((err) => {
            console.error('Error sending ICE candidate:', err);
          });
        };

        pc.oniceconnectionstatechange = () => {
          devLog('ICE connection state:', pc.iceConnectionState);
          console.log('WEBRTC_ICE_CONNECTION_STATE', { callId, state: pc.iceConnectionState });
          videoCallTrace('ICE_CONNECTION_STATE', callId, { state: pc.iceConnectionState });
          if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            console.log('WEBRTC_ICE_CONNECTED', { callId, state: pc.iceConnectionState });
          }
          if (pc.iceConnectionState === 'failed') {
            this.iceFailureCount++;
            devLog(`ICE connection failed (attempt ${this.iceFailureCount}), attempting restart...`);
            
            if (this.iceFailureCount <= 2) {
              logWebrtcIceReconnect(callId);
              // Try restartIce up to 2 times
              pc.restartIce();
              
              // If still failed after 10 seconds, trigger callback
              if (this.iceFailureTimeout) clearTimeout(this.iceFailureTimeout);
              this.iceFailureTimeout = setTimeout(() => {
                if (pc.iceConnectionState === 'failed' && this.onIceFailureCallback) {
                  devLog('ICE connection persistently failed after restart attempts');
                  this.onIceFailureCallback();
                }
              }, 10000);
            } else {
              // Too many failures, trigger callback
              if (this.onIceFailureCallback) {
                devLog('ICE connection failed too many times, giving up');
                this.onIceFailureCallback();
              }
            }
          } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            // Reset failure count on success
            this.iceFailureCount = 0;
            if (this.iceFailureTimeout) {
              clearTimeout(this.iceFailureTimeout);
              this.iceFailureTimeout = null;
            }
          }
        };

        pc.onconnectionstatechange = () => {
          devLog('Peer connection state:', pc.connectionState);
          console.log('WEBRTC_CONNECTION_STATE', { callId, state: pc.connectionState });
          videoCallTrace('PC_CONNECTION_STATE', callId, { state: pc.connectionState });
          if (pc.connectionState === 'connected') {
            callLatencyMark(callId, 'WEBRTC_CONNECTED');
            devLog('SUCCESS: WebRTC Media Path Connected!');
            this.notifyMediaConnected(callId);
          }
        };

        pc.onsignalingstatechange = () => {
          devLog('Signaling state:', pc.signalingState);
          videoCallTrace('LOCAL_DESCRIPTION_SET', callId, {
            signalingState: pc.signalingState,
            localType: pc.localDescription?.type ?? null,
            remoteType: pc.remoteDescription?.type ?? null,
          });
        };

        return pc;
      } catch (error) {
        console.error('Error creating RTCPeerConnection:', error);
        // Reset state so subsequent calls are not blocked by a failed initialization
        this.peerConnection = null;
        this.currentCallId = null;
        throw error;
      } finally {
        this.initializingPromise = null;
      }
    })();

    return this.initializingPromise;
  }

  /** True when beginOutgoingCallerMediaPrep finished for this call (stream may be cached). */
  hasPreparedMedia(callId: string): boolean {
    return (
      this.mediaPrepCompleteForCallId === callId &&
      !!this.localStream &&
      this.currentCallId === callId
    );
  }

  /**
   * Reuse incoming-ring preview camera (video-only) — add mic without reopening camera.
   */
  private async adoptIncomingPreviewAsLocal(callId: string): Promise<MediaStream | null> {
    const preview = this.incomingPreviewStream;
    if (!preview || preview.getVideoTracks().length === 0) return null;

    this.incomingPreviewStream = null;
    if (preview.getAudioTracks().length === 0 && mediaDevices) {
      try {
        const audioOnly = await mediaDevices.getUserMedia({ audio: true, video: false });
        audioOnly.getAudioTracks().forEach((t) => preview.addTrack(t));
      } catch (err) {
        devWarn('[WebRTC] adopt preview: audio add failed', err);
        preview.getVideoTracks().forEach((t) => t.stop());
        return null;
      }
    }

    this.localStream = preview;
    if (!this.peerConnection || this.currentCallId !== callId) {
      await this.initializePeerConnection(callId);
    }
    this.addLocalTracksToPC();
    devLog('[WebRTC] adopted incoming preview stream for', callId);
    return preview;
  }

  async requestLocalStream(
    callId: string,
    callType: 'audio' | 'video',
  ): Promise<MediaStream> {
    if (!isWebRTCAvailable || !mediaDevices) {
      throw new Error('WebRTC not available.');
    }

    const needsVideo = callType === 'video';

    if (needsVideo && this.incomingPreviewStream) {
      const adopted = await this.adoptIncomingPreviewAsLocal(callId);
      if (adopted) return adopted;
    }

    if (this.localStream && this.currentCallId === callId) {
      const hasVideoTrack = this.localStream.getVideoTracks().length > 0;
      if (!needsVideo || hasVideoTrack) {
        devLog('[WebRTC] Reusing prepared local stream for call:', callId);
        const tracks = this.localStream.getTracks().map((t) => t.kind);
        devLog('[WebRTC] local stream tracks:', tracks);
        if (!this.peerConnection || this.currentCallId !== callId) {
          await this.initializePeerConnection(callId);
        }
        this.addLocalTracksToPC();
        return this.localStream;
      }
      devWarn('[WebRTC] cached stream has no video — re-acquiring with video');
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    const constraints = {
      audio: true,
      video: needsVideo ? buildVideoConstraints() : false,
    };

    devLog('[WebRTC] getUserMedia constraints:', JSON.stringify(constraints));

    try {
      let stream: MediaStream;
      try {
        stream = await mediaDevices.getUserMedia(constraints);
      } catch (err) {
        devWarn('[WebRTC] getUserMedia failed:', err);
        if (needsVideo) {
          devWarn('[WebRTC] video failed, falling back to audio only');
          stream = await mediaDevices.getUserMedia({ audio: true, video: false });
        } else {
          throw err;
        }
      }

      if (!stream) throw new Error('getUserMedia returned null');

      const tracks = stream.getTracks().map((t) => t.kind);
      devLog('[WebRTC] local stream tracks:', tracks);

      this.localStream = stream;

      if (!this.peerConnection || this.currentCallId !== callId) {
        await this.initializePeerConnection(callId);
      }

      this.addLocalTracksToPC();

      if (
        this.peerConnection?.remoteDescription &&
        !this.peerConnection.localDescription &&
        this.pendingCallInfo
      ) {
        await this.createAndSendAnswer();
      }

      return stream;
    } catch (error: unknown) {
      console.error('Error in requestLocalStream:', error);
      throw error;
    }
  }

  private addLocalTracksToPC() {
    if (!this.peerConnection || !this.localStream) {
      devLog('Cannot add tracks: PC or localStream missing');
      return;
    }

    const currentSenders = this.peerConnection.getSenders();
    const tracks = this.localStream.getTracks();

    tracks.forEach((track) => {
      const alreadyAdded = currentSenders.some((s: any) => s.track === track);
      if (!alreadyAdded) {
        devLog('Adding track to PC:', track.kind, track.id);
        this.peerConnection?.addTrack(track, this.localStream!);
      } else {
        devLog('Track already attached:', track.kind);
      }
    });
  }

  /** Caller-only: create and send SDP offer once per callId. */
  async createAndSendOffer(callId: string, callerId: string, receiverId: string): Promise<void> {
    if (offerSentForCall.has(callId)) {
      devWarn('[WebRTC] offer already sent for', callId, '— skipping');
      return;
    }

    if (!this.currentCallId || this.currentCallId !== callId) {
      devLog('createAndSendOffer: call context gone, aborting');
      return;
    }

    if (!this.localStream) {
      throw new Error('Cannot create offer: local stream must be captured first');
    }

    offerSentForCall.add(callId);
    this.signalingConfig = { callId, userId: callerId, otherUserId: receiverId };

    const pc = await this.initializePeerConnection(callId);
    if (this.currentCallId !== callId || !this.peerConnection) {
      offerSentForCall.delete(callId);
      throw new Error('Call context switched - aborting offer');
    }

    this.addLocalTracksToPC();

    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });

    if (this.currentCallId !== callId || pc.signalingState === 'closed') {
      offerSentForCall.delete(callId);
      throw new Error('Call context switched - aborting offer');
    }

    await pc.setLocalDescription(offer);
    devLog('Local description set (Offer)');

    await sendSignalingMessage(callId, callerId, receiverId, 'offer', offer);
    devLog('Signaling offer sent');
    videoCallTrace('WEBRTC_OFFER_SENT', callId, { from: callerId, to: receiverId });
    await this.flushPendingRemoteAnswer();
  }

  /** @deprecated Use createAndSendOffer */
  async createOffer(callId: string, callerId: string, receiverId: string): Promise<void> {
    return this.createAndSendOffer(callId, callerId, receiverId);
  }

  async handleOffer(callId: string, offer: any, receiverId: string, callerId: string): Promise<void> {
    if (this.currentCallId && this.currentCallId !== callId) {
      this.prepareForCall(callId);
    }

    devLog('Handling incoming offer for call:', callId);
    this.pendingCallInfo = { callId, receiverId, callerId };
    this.signalingConfig = { callId, userId: receiverId, otherUserId: callerId };

    const pc = await this.initializePeerConnection(callId);

    if (pc.localDescription?.type === 'answer') {
      devLog('handleOffer: local answer already set — skip');
      return;
    }

    if (this.remoteOfferAppliedForCallId === callId && pc.remoteDescription?.type === 'offer') {
      devLog('handleOffer: duplicate offer ignored for', callId);
      if (this.localStream && !pc.localDescription) {
        await this.createAndSendAnswer();
      }
      return;
    }

    if (
      pc.signalingState !== 'stable' &&
      pc.signalingState !== 'have-remote-offer' &&
      pc.signalingState !== 'have-local-offer'
    ) {
      devWarn('handleOffer: unexpected signaling state', pc.signalingState);
      return;
    }
    if (pc.signalingState === 'have-local-offer' && pc.localDescription?.type === 'offer') {
      devWarn('handleOffer: callee PC has local offer — rolling back for incoming offer');
      try {
        await pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit);
      } catch {
        this.cleanup(callId);
        await this.initializePeerConnection(callId);
      }
    }

    if (pc.remoteDescription?.type === 'offer') {
      devLog('handleOffer: remote offer already applied — skip setRemoteDescription');
      if (this.localStream && !pc.localDescription) {
        await this.createAndSendAnswer();
      }
      return;
    }

    try {
      this.isProcessingRemoteDescription = true;

      console.log('WEBRTC_SET_REMOTE_DESCRIPTION_START', { callId, type: 'offer' });
      videoCallTrace('WEBRTC_OFFER_RECEIVED', callId, { callee: receiverId });
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      console.log('WEBRTC_SET_REMOTE_DESCRIPTION_SUCCESS', { callId, type: 'offer' });
      this.remoteOfferAppliedForCallId = callId;
      devLog('Remote description set (Offer)');

      devLog('Applying', this.remoteIceCandidatesQueue.length, 'queued candidates');
      while (this.remoteIceCandidatesQueue.length > 0) {
        const candidate = this.remoteIceCandidatesQueue.shift();
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }

      if (this.localStream) {
        await this.createAndSendAnswer();
      }
    } catch (error) {
      console.error('Error in handleOffer:', error);
    } finally {
      this.isProcessingRemoteDescription = false;
    }
  }

  /**
   * Apply signaling messages already in Firestore before the live listener attached.
   */
  async hydratePendingSignaling(
    callId: string,
    userId: string,
    otherUserId: string,
    isCaller: boolean,
  ): Promise<void> {
    const messages = await fetchPendingSignalingForCallee(callId, userId);
    for (const message of messages) {
      try {
        if (isCaller && message.type === 'answer' && message.sdp) {
          await this.handleAnswer(message.sdp);
        } else if (!isCaller && message.type === 'offer' && message.sdp) {
          await this.handleOffer(callId, message.sdp, userId, otherUserId);
        } else if (message.type === 'ice-candidate' && message.candidate) {
          await this.handleIceCandidate(message.candidate);
        }
      } catch (err) {
        console.error('[WebRTC] hydratePendingSignaling', message.type, err);
      }
    }
  }

  /** @deprecated Use hydratePendingSignaling */
  hydratePendingSignalingForCallee(
    callId: string,
    calleeId: string,
    callerId: string,
  ): Promise<void> {
    return this.hydratePendingSignaling(callId, calleeId, callerId, false);
  }

  /** Send answer when remote offer + local stream are both ready. */
  async trySendAnswerWhenReady(): Promise<boolean> {
    const pc = this.peerConnection;
    if (!pc || pc.remoteDescription?.type !== 'offer' || !this.localStream) {
      console.log('WEBRTC_CREATE_ANSWER_START', {
        callId: this.currentCallId,
        blocked: true,
        hasPc: !!pc,
        remoteType: pc?.remoteDescription?.type ?? null,
        hasLocalStream: !!this.localStream,
      });
      return false;
    }
    if (pc.localDescription?.type === 'answer') {
      return true;
    }
    await this.createAndSendAnswer();
    return pc.localDescription?.type === 'answer';
  }

  async createAndSendAnswer(): Promise<void> {
    if (!this.peerConnection || !this.pendingCallInfo || !this.localStream) {
      devWarn('Cannot create answer: Missing requirements', {
        pc: !!this.peerConnection,
        info: !!this.pendingCallInfo,
        stream: !!this.localStream,
      });
      return;
    }

    const pc = this.peerConnection;
    if (pc.localDescription?.type === 'answer') {
      devLog('createAndSendAnswer: answer already set — skip');
      return;
    }
    if (pc.signalingState !== 'have-remote-offer') {
      devWarn('createAndSendAnswer: wrong state', pc.signalingState);
      return;
    }

    if (this.creatingAnswerPromise) {
      return this.creatingAnswerPromise;
    }

    this.creatingAnswerPromise = (async () => {
      try {
        console.log('WEBRTC_CREATE_ANSWER_START', { callId: this.pendingCallInfo!.callId });
        devLog('Creating and sending answer');
        this.addLocalTracksToPC();

        const answer = await pc.createAnswer();
        console.log('WEBRTC_CREATE_ANSWER_SUCCESS', { callId: this.pendingCallInfo!.callId });
        if (pc.signalingState !== 'have-remote-offer') {
          devWarn('createAndSendAnswer: state changed before setLocalDescription', pc.signalingState);
          return;
        }
        console.log('WEBRTC_SET_LOCAL_DESCRIPTION_START', {
          callId: this.pendingCallInfo!.callId,
          type: 'answer',
        });
        await pc.setLocalDescription(answer);
        console.log('WEBRTC_SET_LOCAL_DESCRIPTION_SUCCESS', {
          callId: this.pendingCallInfo!.callId,
          type: 'answer',
        });
        devLog('Local description set (Answer)');

        await sendSignalingMessage(
          this.pendingCallInfo!.callId,
          this.pendingCallInfo!.receiverId,
          this.pendingCallInfo!.callerId,
          'answer',
          answer,
        );
        devLog('Answer sent');
        console.log('WEBRTC_SEND_ANSWER_FIRESTORE', { callId: this.pendingCallInfo!.callId });
        console.log('WEBRTC_ANSWER_SENT', { callId: this.pendingCallInfo!.callId });
        videoCallTrace('WEBRTC_ANSWER_SENT', this.pendingCallInfo!.callId, {});
        videoCallTrace('LOCAL_DESCRIPTION_SET', this.pendingCallInfo!.callId, { type: 'answer' });
        this.notifyAnswerReady();
      } catch (error) {
        console.error('Error creating/sending answer:', error);
      }
    })();

    try {
      await this.creatingAnswerPromise;
    } finally {
      this.creatingAnswerPromise = null;
    }
  }

  async handleAnswer(answer: any): Promise<void> {
    if (!this.peerConnection) {
      this.pendingRemoteAnswer = answer;
      return;
    }
    const pc = this.peerConnection;
    const state = pc.signalingState;

    if (pc.remoteDescription?.type === 'answer') {
      devLog('handleAnswer: answer already applied — skip');
      return;
    }
    if (state !== 'have-local-offer') {
      this.pendingRemoteAnswer = answer;
      devWarn('handleAnswer: queued — state', state);
      return;
    }
    this.pendingRemoteAnswer = null;

    console.log('WEBRTC_RECEIVED_ANSWER', { callId: this.currentCallId });
    devLog('Handling incoming answer');
    try {
      this.isProcessingRemoteDescription = true;
      console.log('WEBRTC_SET_REMOTE_DESCRIPTION_START', {
        callId: this.currentCallId,
        type: 'answer',
      });
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('WEBRTC_SET_REMOTE_DESCRIPTION_SUCCESS', {
        callId: this.currentCallId,
        type: 'answer',
      });
      devLog('Remote description set (Answer)');
      videoCallTrace('WEBRTC_ANSWER_RECEIVED', this.currentCallId ?? '', {});
      videoCallTrace('REMOTE_DESCRIPTION_SET', this.currentCallId ?? '', { type: 'answer' });

      while (this.remoteIceCandidatesQueue.length > 0) {
        const candidate = this.remoteIceCandidatesQueue.shift();
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error('Error in handleAnswer:', error);
    } finally {
      this.isProcessingRemoteDescription = false;
    }
  }

  async handleIceCandidate(candidate: any): Promise<void> {
    if (!this.peerConnection) {
      this.remoteIceCandidatesQueue.push(candidate);
      return;
    }

    try {
      if (this.peerConnection.remoteDescription && !this.isProcessingRemoteDescription) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('WEBRTC_ICE_REMOTE', { callId: this.currentCallId });
        videoCallTrace('ICE_RECEIVED', this.currentCallId ?? '', {});
      } else {
        this.remoteIceCandidatesQueue.push(candidate);
      }
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
  }

  setupSignaling(
    callId: string,
    userId: string,
    otherUserId: string,
    isCaller: boolean,
    onRemoteStream?: (stream: MediaStream) => void,
    onIceFailure?: () => void
  ): () => void {
    devLog('Configuring signaling handlers for call:', callId);
    this.onRemoteStreamCallback = onRemoteStream;
    this.onIceFailureCallback = onIceFailure;
    this.iceFailureCount = 0;
    this.signalingConfig = { callId, userId, otherUserId };

    // Unsubscribe existing if any
    if (this.signalingUnsubscribe) {
      this.signalingUnsubscribe();
    }

    this.signalingUnsubscribe = subscribeToSignaling(callId, userId, async (message) => {
      try {
        switch (message.type) {
          case 'offer':
            if (isCaller) break;
            if (this.isProcessingOffer) {
              devWarn('[WebRTC] already processing offer — ignoring duplicate');
              break;
            }
            if (
              this.peerConnection?.signalingState === 'stable' &&
              this.peerConnection?.remoteDescription != null
            ) {
              devWarn('[WebRTC] offer received but already have remote desc — ignoring');
              break;
            }
            this.isProcessingOffer = true;
            try {
              await this.handleOffer(callId, message.sdp, userId, otherUserId);
              if (!isCaller) {
                await this.trySendAnswerWhenReady();
              }
            } finally {
              this.isProcessingOffer = false;
            }
            break;
          case 'answer':
            if (isCaller) await this.handleAnswer(message.sdp);
            break;
          case 'ice-candidate':
            if (message.candidate) await this.handleIceCandidate(message.candidate);
            break;
          case 'hangup':
            devLog('Remote hangup received for call:', callId);
            this.cleanup(callId);
            break;
        }
      } catch (err) {
        console.error('Signaling processing error:', err);
      }
    });

    return () => {
      if (this.signalingUnsubscribe) {
        this.signalingUnsubscribe();
        this.signalingUnsubscribe = null;
      }
    };
  }

  /** Tear down any in-flight peer connection before starting a new outgoing call. */
  prepareForCall(callId: string): void {
    if (this.currentCallId && this.currentCallId !== callId) {
      devLog('prepareForCall: cleaning previous context', this.currentCallId);
      this.cleanup(this.currentCallId);
    }
  }

  /**
   * Caller-only: start ICE gathering + getUserMedia while the CF / Firestore write runs.
   * CallScreen reuses the cached stream via requestLocalStream().
   */
  async prepareOutgoingCallerMedia(
    callId: string,
    isVideo: boolean,
    callerId?: string,
    receiverId?: string,
  ): Promise<void> {
    if (!isWebRTCAvailable || !mediaDevices) return;

    if (
      inflightOutgoingMediaPrep &&
      inflightOutgoingMediaPrepCallId === callId
    ) {
      return inflightOutgoingMediaPrep;
    }

    if (this.mediaPrepCompleteForCallId === callId && this.hasPreparedMedia(callId)) {
      return;
    }

    inflightOutgoingMediaPrepCallId = callId;
    inflightOutgoingMediaPrep = (async () => {
      if (callerId && receiverId) {
        this.signalingConfig = { callId, userId: callerId, otherUserId: receiverId };
      }

      this.prepareForCall(callId);

      const callType: 'audio' | 'video' = isVideo ? 'video' : 'audio';
      const stream = await this.requestLocalStream(callId, callType);
      this.mediaPrepCompleteForCallId = callId;
      devLog(
        'prepareOutgoingCallerMedia complete for',
        callId,
        'tracks:',
        stream.getTracks().map((t) => t.kind),
      );
    })();

    try {
      await inflightOutgoingMediaPrep;
    } finally {
      if (inflightOutgoingMediaPrepCallId === callId) {
        inflightOutgoingMediaPrep = null;
        inflightOutgoingMediaPrepCallId = null;
      }
    }
  }

  cleanup(callId?: string): void {
    // If callId is provided, only cleanup if it matches the current call
    if (callId && this.currentCallId && this.currentCallId !== callId) {
      devLog('Ignoring cleanup request for inactive call:', callId);
      return;
    }

    devLog('WebRTC Service cleanup for call:', this.currentCallId);
    logPeerConnectionDestroyed(this.currentCallId ?? callId);
    this.stopIncomingPreviewStream();
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.iceFailureTimeout) {
      clearTimeout(this.iceFailureTimeout);
      this.iceFailureTimeout = null;
    }
    if (callId) offerSentForCall.delete(callId);
    else offerSentForCall.clear();
    this.mediaPrepCompleteForCallId = null;
    this.creatingAnswerPromise = null;
    this.remoteOfferAppliedForCallId = null;
    this.isProcessingOffer = false;
    this.pendingRemoteAnswer = null;
    this.onAnswerReadyCallback = null;
    this.onMediaConnectedCallback = null;
    if (this.peerConnection) {
      this.peerConnection.onicecandidate = null;
      this.peerConnection.ontrack = null;
      this.peerConnection.oniceconnectionstatechange = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.onsignalingstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.onIceFailureCallback = undefined;
    this.iceFailureCount = 0;
    if (this.signalingUnsubscribe) {
      this.signalingUnsubscribe();
      this.signalingUnsubscribe = null;
    }
    this.remoteStream = null;
    this.remoteIceCandidatesQueue = [];
    this.pendingCallInfo = null;
    this.signalingConfig = null;
    this.initializingPromise = null;
    this.currentCallId = null;
  }

  /** Preview-only camera for incoming video UI (no signaling / peer connection). */
  async requestIncomingPreviewStream(): Promise<MediaStream | null> {
    if (!isWebRTCAvailable || !mediaDevices) return null;
    if (this.incomingPreviewStream) return this.incomingPreviewStream;
    try {
      const stream = await mediaDevices.getUserMedia({
        audio: false,
        video: buildVideoConstraints(),
      });
      this.incomingPreviewStream = stream;
      return stream;
    } catch (error) {
      devWarn('requestIncomingPreviewStream failed:', error);
      return null;
    }
  }

  stopIncomingPreviewStream(): void {
    if (this.incomingPreviewStream) {
      this.incomingPreviewStream.getTracks().forEach((t) => t.stop());
      this.incomingPreviewStream = null;
    }
  }

  getIncomingPreviewStream() {
    return this.incomingPreviewStream;
  }

  getLocalStream() { return this.localStream; }
  getRemoteStream() { return this.remoteStream; }
  getPeerConnection() { return this.peerConnection; }

  toggleVideo(enabled: boolean) {
    this.localStream?.getVideoTracks().forEach(t => t.enabled = enabled);
  }

  toggleMute(muted: boolean) {
    this.localStream?.getAudioTracks().forEach(t => t.enabled = !muted);
  }

  switchCamera() {
    this.localStream?.getVideoTracks().forEach((track: any) => {
      if (track._switchCamera) track._switchCamera();
    });
  }
}

export const webRTCService = new WebRTCService();

/** Parallel with initiateCall CF — PC + getUserMedia + ICE gather before navigation. */
export async function beginOutgoingCallerMediaPrep(
  callId: string,
  isVideo: boolean,
  callerId?: string,
  receiverId?: string,
): Promise<void> {
  await webRTCService.prepareOutgoingCallerMedia(callId, isVideo, callerId, receiverId);
}

/** App boot — load WebRTC native module before first call. */
export function prewarmWebRtcEngine(): void {
  WebRTCService.prewarmEngine();
}


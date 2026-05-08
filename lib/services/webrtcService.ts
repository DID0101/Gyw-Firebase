// Conditional import for react-native-webrtc (requires dev build)
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStream,
  mediaDevices,
  isWebRTCAvailable,
} from '@/lib/webrtc-wrapper';
import { sendSignalingMessage, subscribeToSignaling } from './callService';

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

export class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
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

  async initializePeerConnection(callId: string): Promise<RTCPeerConnection> {
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
        this.remoteIceCandidatesQueue = [];

        // Handle remote stream via ontrack
        pc.ontrack = (event: any) => {
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
            });

            if (this.onRemoteStreamCallback) {
              this.onRemoteStreamCallback(stream);
            }
          }
        };

        pc.onicecandidate = (event: any) => {
          if (event.candidate && this.signalingConfig) {
            devLog('Local ICE candidate generated, sending to other user...');
            sendSignalingMessage(
              this.signalingConfig.callId, 
              this.signalingConfig.userId, 
              this.signalingConfig.otherUserId, 
              'ice-candidate', 
              undefined, 
              event.candidate.toJSON()
            ).catch(err => console.error('Error sending ICE candidate:', err));
          }
        };

        pc.oniceconnectionstatechange = () => {
          devLog('ICE connection state:', pc.iceConnectionState);
          if (pc.iceConnectionState === 'failed') {
            this.iceFailureCount++;
            devLog(`ICE connection failed (attempt ${this.iceFailureCount}), attempting restart...`);
            
            if (this.iceFailureCount <= 2) {
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
          if (pc.connectionState === 'connected') {
            devLog('SUCCESS: WebRTC Media Path Connected!');
          }
        };

        pc.onsignalingstatechange = () => {
          devLog('Signaling state:', pc.signalingState);
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

  async requestLocalStream(callId: string, isVideo: boolean): Promise<MediaStream> {
    if (!isWebRTCAvailable || !mediaDevices) {
      throw new Error('WebRTC not available.');
    }
    
    try {
      devLog('Requesting local stream for call:', callId);
      
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: isVideo ? {
          facingMode: 'user',
          width: { min: 640, ideal: 1280 },
          height: { min: 480, ideal: 720 },
          frameRate: 30,
        } : false,
      });

      if (!stream) {
        throw new Error('getUserMedia returned null');
      }

      this.localStream = stream;

      // Ensure PeerConnection exists for this specific call
      if (!this.peerConnection || this.currentCallId !== callId) {
        await this.initializePeerConnection(callId);
      }

      devLog('Attaching local tracks to PeerConnection');
      this.addLocalTracksToPC();

      // If we have a pending offer (we are the receiver), create the answer now
      if (this.peerConnection?.remoteDescription && !this.peerConnection.localDescription && this.pendingCallInfo) {
        await this.createAndSendAnswer();
      }
      
      return stream;
    } catch (error: any) {
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

  async createOffer(callId: string, callerId: string, receiverId: string): Promise<void> {
    devLog('Creating offer for call:', callId);

    // If cleanup already ran (call ended while we were capturing the stream), bail silently
    if (!this.currentCallId || this.currentCallId !== callId) {
      devLog('createOffer: call context gone, aborting');
      return;
    }

    if (!this.localStream) {
      throw new Error('Cannot create offer: local stream must be captured first');
    }

    this.signalingConfig = { callId, userId: callerId, otherUserId: receiverId };
    const pc = await this.initializePeerConnection(callId);
    
    // Guard: context switched while we were initializing - abort
    if (this.currentCallId !== callId || !this.peerConnection) {
      throw new Error('Call context switched - aborting offer');
    }
    
    // Ensure tracks are added before offer
    this.addLocalTracksToPC();

    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });

    // Guard: PC may have been closed by context switch
    if (this.currentCallId !== callId || pc.signalingState === 'closed') {
      throw new Error('Call context switched - aborting offer');
    }
    await pc.setLocalDescription(offer);
    devLog('Local description set (Offer)');

    await sendSignalingMessage(callId, callerId, receiverId, 'offer', offer);
    devLog('Offer sent');
  }

  async handleOffer(callId: string, offer: any, receiverId: string, callerId: string): Promise<void> {
    devLog('Handling incoming offer for call:', callId);
    this.pendingCallInfo = { callId, receiverId, callerId };
    this.signalingConfig = { callId, userId: receiverId, otherUserId: callerId };
    
    const pc = await this.initializePeerConnection(callId);

    try {
      this.isProcessingRemoteDescription = true;
      
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      devLog('Remote description set (Offer)');

      // Process queued candidates
      devLog('Applying', this.remoteIceCandidatesQueue.length, 'queued candidates');
      while (this.remoteIceCandidatesQueue.length > 0) {
        const candidate = this.remoteIceCandidatesQueue.shift();
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }

      // If we already have local stream (user accepted very fast), create answer
      if (this.localStream) {
        await this.createAndSendAnswer();
      }
    } catch (error) {
      console.error('Error in handleOffer:', error);
    } finally {
      this.isProcessingRemoteDescription = false;
    }
  }

  async createAndSendAnswer(): Promise<void> {
    if (!this.peerConnection || !this.pendingCallInfo || !this.localStream) {
      devWarn('Cannot create answer: Missing requirements', {
        pc: !!this.peerConnection,
        info: !!this.pendingCallInfo,
        stream: !!this.localStream
      });
      return;
    }

    try {
      devLog('Creating and sending answer');
      
      // Ensure tracks are added before answer
      this.addLocalTracksToPC();

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      devLog('Local description set (Answer)');

      await sendSignalingMessage(
        this.pendingCallInfo.callId,
        this.pendingCallInfo.receiverId,
        this.pendingCallInfo.callerId,
        'answer',
        answer
      );
      devLog('Answer sent');
    } catch (error) {
      console.error('Error creating/sending answer:', error);
    }
  }

  async handleAnswer(answer: any): Promise<void> {
    if (!this.peerConnection) return;
    const pc = this.peerConnection;
    const state = pc.signalingState;

    // Already processed (e.g. duplicate message)
    if (state === 'stable' && pc.remoteDescription) {
      devLog('handleAnswer: already have remote description, skipping');
      return;
    }
    // Must be in have-local-offer to accept an answer
    if (state !== 'have-local-offer') {
      devWarn('handleAnswer: wrong state', state, '- cannot set answer');
      return;
    }

    devLog('Handling incoming answer');
    try {
      this.isProcessingRemoteDescription = true;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      devLog('Remote description set (Answer)');

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
            if (!isCaller) await this.handleOffer(callId, message.sdp, userId, otherUserId);
            break;
          case 'answer':
            if (isCaller) await this.handleAnswer(message.sdp);
            break;
          case 'ice-candidate':
            await this.handleIceCandidate(message.candidate);
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

  cleanup(callId?: string): void {
    // If callId is provided, only cleanup if it matches the current call
    if (callId && this.currentCallId && this.currentCallId !== callId) {
      devLog('Ignoring cleanup request for inactive call:', callId);
      return;
    }

    devLog('WebRTC Service cleanup for call:', this.currentCallId);
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.iceFailureTimeout) {
      clearTimeout(this.iceFailureTimeout);
      this.iceFailureTimeout = null;
    }
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


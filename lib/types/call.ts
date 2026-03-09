export interface Call {
  id: string;
  callerId: string;
  receiverId: string;
  type: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'rejected';
  createdAt: string;
  endedAt?: string;
  duration?: number; // Duration in seconds
  chatId?: string; // Associated chat ID
  direction?: 'incoming' | 'outgoing'; // From perspective of current user
  /** True for Discover/Omegle-style random video chat; no chat history, no call log. */
  isRandom?: boolean;
}

export interface CallSignaling {
  callId: string;
  from: string;
  to: string;
  type: 'offer' | 'answer' | 'ice-candidate' | 'hangup';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  timestamp: string;
}


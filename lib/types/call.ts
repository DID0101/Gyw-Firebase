export interface Call {
  id: string;
  callerId: string;
  receiverId: string;
  type: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'rejected' | 'busy';
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

/** Incoming call UI payload (caller info for future incoming UI). */
export interface CallData {
  id: string;
  callerId: string;
  receiverId: string;
  callerName: string;
  avatarUrl?: string;
  type: 'audio' | 'video';
  chatId?: string;
  isRandom?: boolean;
}

/** Actions exposed to incoming call UI. */
export interface CallActions {
  accept: () => Promise<void>;
  reject: () => Promise<void>;
  mute?: () => void;
}


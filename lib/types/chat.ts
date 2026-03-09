export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'seen' | 'failed';

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  text?: string;
  imageUrl?: string;
  videoUrl?: string;
  fileUrl?: string;
  fileName?: string;
  audioUrl?: string;
  audioDuration?: number; // Duration in seconds
  waveform?: number[]; // Future: normalized amplitude bars 0–1 for waveform viz
  type: 'text' | 'image' | 'video' | 'file' | 'audio' | 'call';
  createdAt: string;
  updatedAt?: string;
  readBy: string[]; // Array of user IDs who read the message
  reactions?: Record<string, string[]>; // emoji -> array of user IDs
  replyTo?: {
    messageId: string;
    senderName: string;
    text?: string;
    type?: string;
  }; // Reply to another message
  // Call log fields (for type === 'call')
  callId?: string;
  callType?: 'audio' | 'video';
  callStatus?: 'ended' | 'missed' | 'rejected';
  callDuration?: number; // Duration in seconds
  // Delivery status fields
  status?: MessageStatus;
  sentAt?: string; // ISO timestamp
  deliveredAt?: string; // ISO timestamp
  seenAt?: string; // ISO timestamp
  // Edit/Delete fields
  edited?: boolean; // Indicates message was edited
  editedAt?: string; // ISO timestamp when edit happened
  deleted?: boolean; // true if deleted for everyone
  deletedFor?: string[]; // Array of userIds who deleted the message only for themselves
}

export interface Chat {
  id: string;
  type: 'direct' | 'group';
  participants: string[]; // Array of user IDs
  participantData?: Record<string, {
    name: string;
    avatar?: string;
    username?: string;
  }>;
  lastMessage?: {
    text: string;
    senderId: string;
    createdAt: string;
    type?: 'text' | 'image' | 'video' | 'file' | 'audio' | 'call';
    callType?: 'audio' | 'video';
    callStatus?: 'ended' | 'missed' | 'rejected';
    callDuration?: number;
  };
  lastMessageAt?: string;
  lastSenderId?: string;
  createdAt: string;
  updatedAt: string;
  unreadCount?: Record<string, number>; // userId -> unread count
  name?: string; // For group chats
  avatar?: string; // For group chats
  typing?: Record<string, { at: string }>; // userId -> { at: ISO timestamp }
}

export interface User {
  uid: string;
  phoneNumber: string; // Primary identifier, required
  firstName: string;
  lastName: string;
  username: string; // Unique, searchable
  avatar?: string;
  bio?: string; // Optional bio
  createdAt: string;
  updatedAt: string;
  lastActive?: string; // ISO timestamp for online status
  isOnline?: boolean; // Online status
  /** User IDs this user has blocked (e.g. from Discover). */
  blockedUsers?: string[];
  /** Timestamps of skip actions (for rate limiting). */
  skipTimestamps?: number[];
  /** Timestamp until which user is banned from random chat. */
  randomChatBannedUntil?: string;
}


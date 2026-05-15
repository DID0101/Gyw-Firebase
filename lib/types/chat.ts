export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'seen' | 'failed';

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  /** True for messages authored by Gyw AI. */
  isAI?: boolean;
  /** Optional UI hint when an AI request failed. */
  aiError?: string;
  /** Gyw AI: user image message may carry routing mode + caption as `text`. */
  aiMode?: 'auto' | 'vision' | 'image_gen';
  /** Gyw AI multimodal: AI reply references the user image message id (retry). */
  aiMultimodalSourceMessageId?: string;
  /** Gyw AI: server-side route used for this reply (debug / analytics). */
  aiMultimodalRoute?: string;
  text?: string;
  imageUrl?: string;
  imageWidth?: number;   // pixels — stored at upload time, used to preserve aspect ratio
  imageHeight?: number;  // pixels — avoids FlatList layout-measurement round-trip
  blurhash?: string;     // compact perceptual hash — shown as placeholder while image loads
  videoUrl?: string;
  videoThumbnailUrl?: string; // static frame URL — shown instead of broken video-as-image hack
  fileUrl?: string;
  fileName?: string;
  /** Document / file attachment metadata (not used for image/video). */
  mimeType?: string;
  fileSize?: number;
  extension?: string;
  audioUrl?: string;
  audioDuration?: number; // Duration in seconds
  waveform?: number[]; // Future: normalized amplitude bars 0–1 for waveform viz
  type: 'text' | 'image' | 'video' | 'file' | 'document' | 'audio' | 'call' | 'system' | 'location';
  /** `type === 'location'` — static or live share (live coords live in `liveLocationUpdates/{messageId}`). */
  latitude?: number;
  longitude?: number;
  placeName?: string;
  /** Secondary line under title (e.g. street + city) — WhatsApp-style subtitle. */
  placeAddress?: string;
  /** Static map image URL for list bubble (no interactive MapView in FlatList). */
  previewUrl?: string;
  isLive?: boolean;
  /** ISO — live sharing ends at this time (client-enforced; throttled GPS writes to subcollection). */
  expiresAt?: string;
  /** Same as message id when `isLive`; subcollection path `chats/{chatId}/liveLocationUpdates/{liveSessionId}`. */
  liveSessionId?: string;
  /** Present when `type === 'system'` — lightweight room events (no media). */
  systemKind?:
    | 'member_removed'
    | 'member_left'
    | 'member_added'
    | 'admin_promoted'
    | 'group_created'
    | 'group_avatar_changed'
    | 'group_info_updated';
  systemActorId?: string;
  systemTargetId?: string;
  systemActorName?: string;
  systemTargetName?: string;
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
  /** Reply sent from a story viewer (context chip in UI). */
  storyReply?: {
    storyId: string;
    storyOwnerId: string;
    previewLabel?: string;
    mediaUrl?: string;
    thumbnailUrl?: string;
    mediaType?: string;
  };
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
  /** Mirrors `edited` for Firestore clients that prefer an explicit flag. */
  isEdited?: boolean;
  editedAt?: string; // ISO timestamp when edit happened
  deleted?: boolean; // true if deleted for everyone
  /** True when sender chose delete for everyone (redundant with `deleted`; used for clarity / rules). */
  deletedForEveryone?: boolean;
  deletedAt?: string; // ISO when deleted for everyone
  deletedFor?: string[]; // Array of userIds who deleted the message only for themselves
}

export interface Chat {
  id: string;
  type: 'direct' | 'group';
  participants: string[]; // Array of user IDs
  /** Group: creator uid (also admin). Used when `participantRoles` is absent on legacy docs. */
  createdBy?: string;
  /** Group: uid → role. Admins may remove members (via callable). */
  participantRoles?: Record<string, 'admin' | 'member'>;
  /** Group: uids removed from the room (audit); not in `participants`. */
  removedMembers?: Record<string, string>;
  participantData?: Record<string, {
    name: string;
    avatar?: string;
    username?: string;
  }>;
  lastMessage?: {
    text: string;
    senderId: string;
    createdAt: string;
    type?: 'text' | 'image' | 'video' | 'file' | 'document' | 'audio' | 'call' | 'location';
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
  /** Group: optional topic / rules text. */
  description?: string;
  /** Group: denormalized member count (maintained by callables). */
  participantCount?: number;
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


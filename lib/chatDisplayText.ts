/**
 * Chat list + chatroom display helpers — Unicode-safe, null-safe, emoji-safe.
 */

import type { Chat } from '@/lib/types/chat';
import { resolveDisplayName } from '@/lib/contacts/contactResolver';
import {
  buildDisplayName,
  coerceDisplayString,
  getAvatarInitial,
  normalizeUnicodeInput,
  safeSubstring,
  safeTrim,
} from '@/lib/unicodeText';

export {
  getAvatarInitial,
  getAvatarInitial as safeInitials,
  buildDisplayName,
  buildDisplayName as safeDisplayName,
  safeSubstring,
  safeTrim,
};

/** Message / preview body — never returns "[object Object]" or "undefined". */
export function safePreviewText(value: unknown, maxGraphemes = 240): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    const trimmed = safeTrim(value);
    return trimmed ? safeSubstring(trimmed, maxGraphemes) : '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return safeSubstring(String(value), maxGraphemes);
  }
  if (__DEV__) {
    console.log('CHAT_RENDER_FALLBACK', { kind: 'non_string_preview', type: typeof value });
  }
  return '';
}

/** Sender / participant name for bubbles and typing. */
export function safeSenderName(value: unknown, fallback = 'Unknown'): string {
  const name = safePreviewText(value, 80);
  if (name) return name;
  if (value != null && value !== '') {
    if (__DEV__) console.log('INVALID_NAME_RECOVERED', { value: typeof value });
  }
  if (__DEV__ && !name) console.log('SAFE_INITIALS_USED', { fallback });
  return fallback;
}

export type ChatListTitleInput = {
  type: Chat['type'];
  name?: unknown;
  otherUser?: {
    phoneNumber?: string | null;
    firstName?: unknown;
    lastName?: unknown;
    username?: unknown;
    name?: unknown;
    displayName?: unknown;
  } | null;
  /** Name from chats/{id}.participantData[otherUid].name */
  participantDataName?: unknown;
  /** Phone from chats/{id}.participantData[otherUid].phoneNumber */
  participantDataPhone?: unknown;
  participantCount?: number;
  fallbackUnknown: string;
  fallbackGroup: string;
};

function resolvePersonTitle(
  otherUser: ChatListTitleInput['otherUser'],
  participantDataName?: unknown,
  fallbackUnknown = 'Unknown',
  participantDataPhone?: unknown
): string {
  if (!otherUser && !participantDataName) return '';

  const phone =
    otherUser?.phoneNumber ?? (coerceDisplayString(participantDataPhone) || undefined);

  const resolved = resolveDisplayName(
    {
      phoneNumber: phone,
      firstName: otherUser?.firstName,
      lastName: otherUser?.lastName,
      username: otherUser?.username,
      displayName: otherUser?.displayName,
      participantName: participantDataName,
      name: otherUser?.name,
    },
    { fallback: '', logContext: 'chat_title', preferLiveProfile: true }
  );
  if (resolved) return resolved;

  const participant = safeTrim(participantDataName);
  if (participant) return participant;

  return fallbackUnknown;
}

/** Chat list row + header title. */
export function formatChatListTitle(input: ChatListTitleInput): string {
  const othersCount =
    typeof input.participantCount === 'number' && input.participantCount > 0
      ? Math.max(0, input.participantCount - 1)
      : 0;

  if (input.type === 'group') {
    // Two-person group: show the contact name (not the group label) — common user expectation.
    if (othersCount === 1) {
      const person = resolvePersonTitle(
        input.otherUser,
        input.participantDataName,
        input.fallbackUnknown,
        input.participantDataPhone
      );
      if (person) return person;
    }
    const group = safeTrim(input.name);
    if (group) return group;
    if (__DEV__) console.log('CHAT_RENDER_FALLBACK', { kind: 'group_name' });
    return input.fallbackGroup;
  }

  const person = resolvePersonTitle(
    input.otherUser,
    input.participantDataName,
    input.fallbackUnknown,
    input.participantDataPhone
  );
  if (person) return person;

  if (__DEV__) console.log('CHAT_RENDER_FALLBACK', { kind: 'direct_title' });
  return input.fallbackUnknown;
}

/** Resolve sender label for bubbles, replies, typing (sync; uses preloaded cache). */
export function resolveMessageSenderLabel(input: {
  senderName?: unknown;
  phoneNumber?: string | null;
  firstName?: unknown;
  lastName?: unknown;
  username?: unknown;
  displayName?: unknown;
}, fallback = 'Unknown'): string {
  const snapshot = safeSenderName(input.senderName, '');
  return resolveDisplayName(
    {
      phoneNumber: input.phoneNumber,
      firstName: input.firstName,
      lastName: input.lastName,
      username: input.username,
      displayName: input.displayName,
      name: snapshot,
    },
    { fallback, logContext: 'message_sender', preferLiveProfile: true }
  );
}

export type LastMessagePreviewLabels = {
  noMessagesYet: string;
  you: string;
  youSentMedia: string;
  mediaMessage: string;
  call: string;
  missedVideoCall: string;
  missedAudioCall: string;
  videoCall: string;
  audioCall: string;
  callRejected: string;
  callDuration: string;
};

/** Last message subtitle on chats list — null-safe, emoji-safe. */
export function formatLastMessagePreview(
  lastMessage: Chat['lastMessage'] | null | undefined,
  currentUserId: string,
  labels: LastMessagePreviewLabels
): string {
  if (!lastMessage) return labels.noMessagesYet;

  if (lastMessage.type === 'call') {
    const callType = lastMessage.callType === 'video' ? '📹' : '📞';
    if (lastMessage.callStatus === 'missed') {
      return `${callType} ${
        lastMessage.callType === 'video' ? labels.missedVideoCall : labels.missedAudioCall
      }`;
    }
    if (lastMessage.callStatus === 'rejected') {
      return `${callType} ${
        lastMessage.callType === 'video' ? labels.videoCall : labels.audioCall
      } ${labels.callRejected}`;
    }
    if (lastMessage.callStatus === 'ended') {
      if (lastMessage.callDuration && lastMessage.callDuration > 0) {
        const minutes = Math.floor(lastMessage.callDuration / 60);
        const seconds = lastMessage.callDuration % 60;
        const durationText =
          minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;
        return `${callType} ${
          lastMessage.callType === 'video' ? labels.videoCall : labels.audioCall
        } ${labels.callDuration} ${durationText}`;
      }
      return `${callType} ${lastMessage.callType === 'video' ? labels.videoCall : labels.audioCall}`;
    }
    return safePreviewText(lastMessage.text, 120) || labels.call;
  }

  const text = safePreviewText(lastMessage.text, 200);
  if (text) {
    return lastMessage.senderId === currentUserId ? `${labels.you}: ${text}` : text;
  }

  return lastMessage.senderId === currentUserId ? labels.youSentMedia : labels.mediaMessage;
}

/** Normalize message fields when hydrating from Firestore (defensive). */
export function normalizeChatMessageFields<T extends { senderName?: unknown; text?: unknown }>(
  msg: T
): T {
  return {
    ...msg,
    senderName: safeSenderName(msg.senderName, 'Unknown'),
    text: msg.text == null ? msg.text : safePreviewText(msg.text, 10000) || undefined,
  };
}

/** Single-line search across chat title + last preview (client-side filter). */
export function chatMatchesSearchQuery(
  title: string,
  lastPreview: string,
  query: string
): boolean {
  const q = normalizeUnicodeInput(query).toLocaleLowerCase(undefined);
  if (!q) return true;
  const hay = `${title}\n${lastPreview}`.toLocaleLowerCase(undefined);
  return hay.includes(q);
}

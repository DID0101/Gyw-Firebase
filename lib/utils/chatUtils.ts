/**
 * Chat UX utilities - date formatting, message grouping, etc.
 */
import { ChatMessage } from '@/lib/types/chat';

export const formatDateHeader = (timestamp?: string): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${monthNames[date.getMonth()]} ${date.getDate()}`;
};

export const formatBubbleTime = (ts?: string): string => {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  return isToday
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const GROUP_TIME_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

/** Show tail (pointing corner) only on last message of a cluster */
export const shouldShowTail = (messages: ChatMessage[], index: number): boolean => {
  if (index === messages.length - 1) return true;
  const current = messages[index];
  const next = messages[index + 1];
  if (!current || !next) return true;
  if (current.senderId !== next.senderId) return true;
  const currentTime = new Date(current.createdAt || 0).getTime();
  const nextTime = new Date(next.createdAt || 0).getTime();
  return (nextTime - currentTime) > GROUP_TIME_THRESHOLD_MS;
};

/** Show sender name/avatar only on first message of a cluster (group chats) */
export const shouldShowSender = (messages: ChatMessage[], index: number): boolean => {
  if (index === 0) return true;
  const current = messages[index];
  const prev = messages[index - 1];
  if (!current || !prev) return true;
  if (current.senderId !== prev.senderId) return true;
  const currentTime = new Date(current.createdAt || 0).getTime();
  const prevTime = new Date(prev.createdAt || 0).getTime();
  return (currentTime - prevTime) > GROUP_TIME_THRESHOLD_MS;
};

/** Is this message first in cluster (reduced padding) */
export const isFirstInCluster = (messages: ChatMessage[], index: number): boolean => {
  return shouldShowSender(messages, index);
};

/** Is this message last in cluster */
export const isLastInCluster = (messages: ChatMessage[], index: number): boolean => {
  return shouldShowTail(messages, index);
};

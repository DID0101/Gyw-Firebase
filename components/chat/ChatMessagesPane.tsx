import { memo, type ReactNode } from 'react';
import { EMPTY_MESSAGES, useChatStore } from '@/store/chatStore';
import type { ChatMessage } from '@/lib/types/chat';

type ChatMessagesPaneProps = {
  chatId: string;
  children: (messages: ChatMessage[]) => ReactNode;
};

/**
 * Isolates Zustand message subscription so the parent ChatScreen does not
 * re-render on every snapshot / receipt update.
 */
const ChatMessagesPane = memo(function ChatMessagesPane({
  chatId,
  children,
}: ChatMessagesPaneProps) {
  const messages = useChatStore((state) => state.messagesByChat[chatId] ?? EMPTY_MESSAGES);
  return <>{children(messages)}</>;
});

export default ChatMessagesPane;

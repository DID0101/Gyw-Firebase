import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlatList } from 'react-native';
import { ChatMessage } from '@/lib/types/chat';

const AT_BOTTOM_THRESHOLD = 50;
const SCROLLED_AWAY_THRESHOLD = 100;
const LOAD_OLDER_THRESHOLD = 150;
const STICKY_DATE_MIN_OFFSET = 60;
const APPROX_ROW_HEIGHT = 72;
/** Debounce UI-only scroll chrome updates (fab, date pill) — not scroll position. */
const SCROLL_UI_DEBOUNCE_MS = 32;

type UseChatScrollControllerOpts = {
  chatId: string | undefined;
  listRef: React.RefObject<FlatList<ChatMessage> | null>;
  messageCount: number;
  hasMoreOlderMessages: boolean;
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  suppressNextBottomScrollRef: React.MutableRefObject<boolean>;
  formatDateHeader: (iso: string) => string;
};

/**
 * Inverted-list scroll UX: ref-based at-bottom for hot paths, debounced setState for chrome only.
 */
export function useChatScrollController({
  chatId,
  listRef,
  messageCount,
  hasMoreOlderMessages,
  messagesRef,
  suppressNextBottomScrollRef,
  formatDateHeader,
}: UseChatScrollControllerOpts) {
  const didInitialPinRef = useRef(false);
  const isAtBottomRef = useRef(true);
  const prevMessagesLengthRef = useRef(0);
  const lastReadCountRef = useRef(0);
  const hasMoreOlderRef = useRef(hasMoreOlderMessages);
  const scrollUiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollLogRef = useRef({ lastTs: 0, lastAtBottom: true });

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewMessagesButton, setShowNewMessagesButton] = useState(false);
  const [showLoadingOlderBanner, setShowLoadingOlderBanner] = useState(false);
  const [stickyDateLabel, setStickyDateLabel] = useState<string | null>(null);
  const [newMessagesCount, setNewMessagesCount] = useState(0);

  useEffect(() => {
    didInitialPinRef.current = false;
  }, [chatId]);

  useEffect(() => {
    hasMoreOlderRef.current = hasMoreOlderMessages;
  }, [hasMoreOlderMessages]);

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  const scrollToBottom = useCallback(
    (animated: boolean) => {
      listRef.current?.scrollToOffset({ offset: 0, animated });
    },
    [listRef]
  );

  const onScrollFabPress = useCallback(() => {
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    setShowNewMessagesButton(false);
    setNewMessagesCount(0);
    lastReadCountRef.current = messageCount;
    scrollToBottom(true);
  }, [messageCount, scrollToBottom]);

  // Auto-scroll on new messages when user is at bottom
  useEffect(() => {
    const prev = prevMessagesLengthRef.current;
    if (messageCount > prev && prev > 0 && isAtBottomRef.current) {
      if (suppressNextBottomScrollRef.current) {
        suppressNextBottomScrollRef.current = false;
      } else {
        scrollToBottom(false);
        if (__DEV__) {
          console.log('AUTO_SCROLL_TRIGGER', { reason: 'new_message', messageCount, prev });
        }
      }
    }
    prevMessagesLengthRef.current = messageCount;
  }, [messageCount, scrollToBottom, suppressNextBottomScrollRef]);

  // New message badge when scrolled up
  useEffect(() => {
    if (isAtBottom) {
      lastReadCountRef.current = messageCount;
      setNewMessagesCount(0);
    } else if (messageCount > lastReadCountRef.current) {
      setNewMessagesCount(messageCount - lastReadCountRef.current);
    }
  }, [messageCount, isAtBottom]);

  const handleScroll = useCallback(
    (event: {
      nativeEvent: {
        contentOffset: { y: number };
        contentSize: { height: number };
        layoutMeasurement: { height: number };
      };
    }) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent ?? {};
      const contentOffsetY = contentOffset?.y ?? 0;
      const viewH = layoutMeasurement?.height ?? 0;
      const contentH = contentSize?.height ?? 0;

      const atBottom = contentOffsetY < AT_BOTTOM_THRESHOLD;
      isAtBottomRef.current = atBottom;
      if (__DEV__) {
        const now = Date.now();
        const shouldLog =
          now - scrollLogRef.current.lastTs > 500 ||
          scrollLogRef.current.lastAtBottom !== atBottom;
        if (shouldLog) {
          scrollLogRef.current.lastTs = now;
          scrollLogRef.current.lastAtBottom = atBottom;
          console.log('CHAT_SCROLL_STATE', { atBottom, y: Math.round(contentOffsetY) });
        }
      }

      if (scrollUiTimerRef.current) clearTimeout(scrollUiTimerRef.current);
      scrollUiTimerRef.current = setTimeout(() => {
        const msgs = messagesRef.current;
        const messagesLength = msgs.length;
        const scrolledAway = contentOffsetY > SCROLLED_AWAY_THRESHOLD;
        const distFromOldest = contentH - viewH - contentOffsetY;

        setIsAtBottom((prev) => (prev === atBottom ? prev : atBottom));
        const showFab = scrolledAway && messagesLength > 0;
        setShowNewMessagesButton((prev) => (prev === showFab ? prev : showFab));
        const showOlder =
          distFromOldest < LOAD_OLDER_THRESHOLD &&
          messagesLength > 0 &&
          hasMoreOlderRef.current;
        setShowLoadingOlderBanner((prev) => (prev === showOlder ? prev : showOlder));

        let nextLabel: string | null = null;
        if (messagesLength > 0 && contentOffsetY > STICKY_DATE_MIN_OFFSET) {
          const approxIdx = Math.min(
            Math.max(0, Math.floor(contentOffsetY / APPROX_ROW_HEIGHT)),
            messagesLength - 1
          );
          const msg = msgs[approxIdx];
          if (msg?.createdAt) nextLabel = formatDateHeader(msg.createdAt);
        }
        setStickyDateLabel((prev) => (prev === nextLabel ? prev : nextLabel));
      }, SCROLL_UI_DEBOUNCE_MS);
    },
    [formatDateHeader, messagesRef]
  );

  useEffect(() => {
    return () => {
      if (scrollUiTimerRef.current) clearTimeout(scrollUiTimerRef.current);
    };
  }, []);

  const handleListContentSizeChange = useCallback(() => {
    const count = messagesRef.current.length;
    if (count === 0) return;

    if (!didInitialPinRef.current) {
      didInitialPinRef.current = true;
      isAtBottomRef.current = true;
      scrollToBottom(false);
      if (__DEV__) {
        console.log('AUTO_SCROLL_TRIGGER', { reason: 'initial_content_size', count });
      }
      return;
    }

    if (isAtBottomRef.current) {
      requestAnimationFrame(() => {
        scrollToBottom(false);
        if (__DEV__) {
          console.log('AUTO_SCROLL_TRIGGER', { reason: 'content_size_at_bottom', count });
        }
      });
    }
  }, [messagesRef, scrollToBottom]);

  return {
    isAtBottomRef,
    isAtBottom,
    showNewMessagesButton,
    showLoadingOlderBanner,
    stickyDateLabel,
    newMessagesCount,
    handleScroll,
    onScrollFabPress,
    scrollToBottom,
    handleListContentSizeChange,
  };
}

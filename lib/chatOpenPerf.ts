/**
 * Chat open performance profiling (DEV-oriented).
 *
 * High-resolution relative times via performance.now() when available.
 * Use Metro logs to read CHAT_PERF_* lines and the final CHAT_PERF_SUMMARY.
 */

type ChatOpenMark = {
  tapAt?: number;
  /** Right before router.push (intent to navigate). */
  navIntentAt?: number;
  /** Immediately after router.push returns (sync boundary). */
  routerPushReturnedAt?: number;
  /** First synchronous execution of ChatScreen function body (approx mount start). */
  screenFnEnterAt?: number;
  /** useLayoutEffect: header hydrate + first layout commit. */
  firstLayoutAt?: number;
  /** InteractionManager.runAfterInteractions fired after mount (first idle after transitions). */
  afterInteractionsAt?: number;
  /** FlatList onLayout first callback (list viewport laid out). */
  flatListLayoutAt?: number;
  /** First onContentSizeChange when messages.length > 0. */
  flatListContentSizedAt?: number;
  /** startChatMessageListener entered (before subscribe). */
  messageListenerStartAt?: number;
  /** First applyMessages / snapshot merged into store. */
  messageFirstSnapshotAt?: number;
  /** Message listener scheduled (start of rAF chain). */
  messageListenerScheduledAt?: number;
  /** Two rAFs complete + startChatMessageListener called. */
  messageListenerAttachedAt?: number;
  /** Chat doc subscription: InteractionManager task started. */
  chatDocTaskStartAt?: number;
  /** First chat document snapshot (typing/presence path). */
  chatDocFirstSnapshotAt?: number;
  /** Other user doc listener first snapshot (presence header). */
  userDocFirstSnapshotAt?: number;
  messagesLoadedAt?: number;
  /** Pull-to-load older batch finished. */
  paginationDoneAt?: number;
  paginationDurationMs?: number;
  readyAt?: number;
};

const marks = new Map<string, ChatOpenMark>();

/** Active chat id for render probes (MessageBubble, etc.). */
let perfSessionChatId: string | null = null;

const renderCounts: Record<string, number> = {
  ChatScreen: 0,
  ChatRoomHeader: 0,
  MessageBubble: 0,
  Composer: 0,
  ChatRoomBody: 0,
};

function nowMs(): number {
  const p = typeof globalThis !== 'undefined' ? (globalThis as { performance?: { now?: () => number } }).performance : undefined;
  return typeof p?.now === 'function' ? p.now() : Date.now();
}

function get(chatId: string): ChatOpenMark {
  const existing = marks.get(chatId);
  if (existing) return existing;
  const created: ChatOpenMark = {};
  marks.set(chatId, created);
  return created;
}

function log(message: string) {
  if (__DEV__) console.log(message);
}

function delta(from?: number, to?: number): number {
  if (from == null || to == null) return -1;
  return Math.round(to - from);
}

/** Start / end profiling session for child components (MessageBubble render counts). */
export function chatPerfSessionStart(chatId: string) {
  perfSessionChatId = chatId;
  if (__DEV__) {
    renderCounts.ChatScreen = 0;
    renderCounts.ChatRoomHeader = 0;
    renderCounts.MessageBubble = 0;
    renderCounts.Composer = 0;
    renderCounts.ChatRoomBody = 0;
  }
}

export function chatPerfSessionEnd() {
  perfSessionChatId = null;
}

export function bumpChatPerfRender(component: keyof typeof renderCounts) {
  if (!__DEV__ || !perfSessionChatId) return;
  renderCounts[component] += 1;
}

export function markChatTap(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  m.tapAt = nowMs();
  log(`CHAT_PERF_TAP chatId=${chatId} t=${m.tapAt.toFixed(1)}`);
}

export function markChatNavStart(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  m.navIntentAt = nowMs();
  log(`CHAT_PERF_NAV_INTENT chatId=${chatId} t=${m.navIntentAt.toFixed(1)} TAP_TO_NAV_INTENT=${delta(m.tapAt, m.navIntentAt)}ms`);
}

/** Call synchronously immediately after `router.push(...)` returns. */
export function markChatRouterPushReturned(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  m.routerPushReturnedAt = nowMs();
  const tap = m.tapAt;
  log(
    `CHAT_PERF_ROUTER_PUSH_RETURNED chatId=${chatId} t=${m.routerPushReturnedAt.toFixed(1)} TAP_TO_PUSH_RETURN=${delta(tap, m.routerPushReturnedAt)}ms`
  );
}

/** First line of ChatScreen body (once per navigation). */
export function markChatScreenFnEnter(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.screenFnEnterAt != null) return;
  m.screenFnEnterAt = nowMs();
  log(
    `CHAT_PERF_SCREEN_FN_ENTER chatId=${chatId} t=${m.screenFnEnterAt.toFixed(1)} TAP_TO_SCREEN_FN=${delta(m.tapAt, m.screenFnEnterAt)}ms`
  );
}

export function markChatFirstLayout(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.firstLayoutAt) return;
  m.firstLayoutAt = nowMs();
  log(
    `CHAT_PERF_FIRST_LAYOUT chatId=${chatId} t=${m.firstLayoutAt.toFixed(1)} TAP_TO_FIRST_LAYOUT=${delta(m.tapAt, m.firstLayoutAt)}ms NAV_TO_FIRST_LAYOUT=${delta(m.routerPushReturnedAt, m.firstLayoutAt)}ms`
  );
}

export function markChatAfterInteractions(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.afterInteractionsAt) return;
  m.afterInteractionsAt = nowMs();
  log(
    `CHAT_PERF_AFTER_INTERACTIONS chatId=${chatId} t=${m.afterInteractionsAt.toFixed(1)} TAP_TO_AFTER_INTERACTIONS=${delta(m.tapAt, m.afterInteractionsAt)}ms`
  );
}

export function markFlatListLayout(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.flatListLayoutAt) return;
  m.flatListLayoutAt = nowMs();
  log(
    `CHAT_PERF_FLATLIST_LAYOUT chatId=${chatId} t=${m.flatListLayoutAt.toFixed(1)} TAP_TO_LIST_LAYOUT=${delta(m.tapAt, m.flatListLayoutAt)}ms`
  );
}

export function markFlatListContentSized(chatId: string, messageCount: number) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.flatListContentSizedAt) return;
  if (messageCount === 0) return;
  m.flatListContentSizedAt = nowMs();
  log(
    `CHAT_PERF_FLATLIST_CONTENT chatId=${chatId} messages=${messageCount} t=${m.flatListContentSizedAt.toFixed(1)} TAP_TO_LIST_CONTENT=${delta(m.tapAt, m.flatListContentSizedAt)}ms`
  );
}

export function markMessageListenerScheduled(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.messageListenerScheduledAt) return;
  m.messageListenerScheduledAt = nowMs();
  log(`CHAT_PERF_MSG_LISTENER_SCHEDULED chatId=${chatId} t=${m.messageListenerScheduledAt.toFixed(1)}`);
}

export function markChatScreenMount(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.messageListenerAttachedAt) return;
  m.messageListenerAttachedAt = nowMs();
  log(
    `CHAT_PERF_MSG_LISTENER_ATTACHED chatId=${chatId} t=${m.messageListenerAttachedAt.toFixed(1)} SCHEDULE_TO_ATTACH=${delta(m.messageListenerScheduledAt, m.messageListenerAttachedAt)}ms`
  );
}

export function markMessageListenerNativeStart(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.messageListenerStartAt) return;
  m.messageListenerStartAt = nowMs();
  log(
    `CHAT_PERF_MSG_LISTENER_START chatId=${chatId} t=${m.messageListenerStartAt.toFixed(1)} TAP_TO_LISTENER_START=${delta(m.tapAt, m.messageListenerStartAt)}ms`
  );
}

export function markMessageFirstSnapshot(chatId: string, count: number) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.messageFirstSnapshotAt) return;
  m.messageFirstSnapshotAt = nowMs();
  log(
    `CHAT_PERF_MSG_FIRST_SNAPSHOT chatId=${chatId} count=${count} t=${m.messageFirstSnapshotAt.toFixed(1)} TAP_TO_FIRST_SNAPSHOT=${delta(m.tapAt, m.messageFirstSnapshotAt)}ms LISTENER_START_TO_SNAPSHOT=${delta(m.messageListenerStartAt, m.messageFirstSnapshotAt)}ms`
  );
}

export function markChatDocTaskStart(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.chatDocTaskStartAt) return;
  m.chatDocTaskStartAt = nowMs();
  log(`CHAT_PERF_CHATDOC_TASK_START chatId=${chatId} t=${m.chatDocTaskStartAt.toFixed(1)}`);
}

export function markChatDocFirstSnapshot(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.chatDocFirstSnapshotAt) return;
  m.chatDocFirstSnapshotAt = nowMs();
  log(
    `CHAT_PERF_CHATDOC_FIRST_SNAPSHOT chatId=${chatId} t=${m.chatDocFirstSnapshotAt.toFixed(1)} TAP_TO_CHATDOC=${delta(m.tapAt, m.chatDocFirstSnapshotAt)}ms TASK_TO_SNAPSHOT=${delta(m.chatDocTaskStartAt, m.chatDocFirstSnapshotAt)}ms`
  );
}

export function markUserDocFirstSnapshot(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.userDocFirstSnapshotAt) return;
  m.userDocFirstSnapshotAt = nowMs();
  log(`CHAT_PERF_USERDOC_FIRST_SNAPSHOT chatId=${chatId} t=${m.userDocFirstSnapshotAt.toFixed(1)}`);
}

export function markChatMessagesLoaded(chatId: string, count: number) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.messagesLoadedAt) return;
  m.messagesLoadedAt = nowMs();
  log(`CHAT_PERF_MESSAGES_LOADED chatId=${chatId} count=${count} t=${m.messagesLoadedAt.toFixed(1)}`);
}

export function markPaginationComplete(chatId: string, durationMs: number) {
  if (!chatId) return;
  const m = get(chatId);
  m.paginationDoneAt = nowMs();
  m.paginationDurationMs = durationMs;
  log(`CHAT_PERF_PAGINATION_DONE chatId=${chatId} durationMs=${Math.round(durationMs)} t=${m.paginationDoneAt.toFixed(1)}`);
}

export function markChatReady(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.readyAt) return;
  m.readyAt = nowMs();
  log(`CHAT_PERF_READY chatId=${chatId} t=${m.readyAt.toFixed(1)}`);

  const tap = m.tapAt;
  const total = tap != null ? m.readyAt - tap : -1;

  log(
    `CHAT_PERF_SUMMARY chatId=${chatId} ` +
      `TOTAL_MS=${total >= 0 ? Math.round(total) : -1} ` +
      `tap→navIntent=${delta(tap, m.navIntentAt)}ms ` +
      `navIntent→routerPush=${delta(m.navIntentAt, m.routerPushReturnedAt)}ms ` +
      `tap→routerPush=${delta(tap, m.routerPushReturnedAt)}ms ` +
      `routerPush→screenFn=${delta(m.routerPushReturnedAt, m.screenFnEnterAt)}ms ` +
      `screenFn→firstLayout=${delta(m.screenFnEnterAt, m.firstLayoutAt)}ms ` +
      `firstLayout→afterInteractions=${delta(m.firstLayoutAt, m.afterInteractionsAt)}ms ` +
      `firstLayout→listLayout=${delta(m.firstLayoutAt, m.flatListLayoutAt)}ms ` +
      `listLayout→listContent=${delta(m.flatListLayoutAt, m.flatListContentSizedAt)}ms ` +
      `tap→firstMsgSnapshot=${delta(tap, m.messageFirstSnapshotAt)}ms ` +
      `listenerStart→firstSnapshot=${delta(m.messageListenerStartAt, m.messageFirstSnapshotAt)}ms ` +
      `tap→chatDoc=${delta(tap, m.chatDocFirstSnapshotAt)}ms ` +
      `firstMsgSnapshot→ready=${delta(m.messageFirstSnapshotAt, m.readyAt)}ms ` +
      `BOTTLENECK_HINT=compare tap→firstLayout vs listenerStart→firstSnapshot vs firstLayout→listLayout (large gaps = sync work / layout / Firestore)`
  );

  if (__DEV__) {
    log(
      `CHAT_PERF_RENDERS chatId=${chatId} ` +
        `ChatScreen=${renderCounts.ChatScreen} ChatRoomBody=${renderCounts.ChatRoomBody} Header=${renderCounts.ChatRoomHeader} Bubble=${renderCounts.MessageBubble} Composer=${renderCounts.Composer}`
    );
  }
}

export function clearChatOpenMark(chatId: string) {
  if (!chatId) return;
  marks.delete(chatId);
}

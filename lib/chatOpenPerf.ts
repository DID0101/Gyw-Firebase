type ChatOpenMark = {
  tapAt?: number;
  navStartAt?: number;
  /** First useLayoutEffect on chat screen (cached header hydrate, before browser/native paint). */
  firstLayoutAt?: number;
  /** Firestore messages subscription started (after deferred frames). */
  screenMountAt?: number;
  messagesLoadedAt?: number;
  readyAt?: number;
};

const marks = new Map<string, ChatOpenMark>();

function nowMs() {
  return Date.now();
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

export function markChatTap(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  m.tapAt = nowMs();
  log(`CHAT_TAP chatId=${chatId} ts=${m.tapAt}`);
}

export function markChatNavStart(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  m.navStartAt = nowMs();
  log(`CHAT_NAV_START chatId=${chatId} ts=${m.navStartAt}`);
}

/** Runs in useLayoutEffect: shell + cached chat title ready before paint. */
export function markChatFirstLayout(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.firstLayoutAt) return;
  m.firstLayoutAt = nowMs();
  log(`CHAT_FIRST_LAYOUT chatId=${chatId} ts=${m.firstLayoutAt}`);
}

export function markChatScreenMount(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.screenMountAt) return;
  m.screenMountAt = nowMs();
  log(`CHAT_LISTENER_START chatId=${chatId} ts=${m.screenMountAt}`);
}

export function markChatMessagesLoaded(chatId: string, count: number) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.messagesLoadedAt) return;
  m.messagesLoadedAt = nowMs();
  log(`CHAT_MESSAGES_LOADED chatId=${chatId} count=${count} ts=${m.messagesLoadedAt}`);
}

export function markChatReady(chatId: string) {
  if (!chatId) return;
  const m = get(chatId);
  if (m.readyAt) return;
  m.readyAt = nowMs();
  log(`CHAT_READY chatId=${chatId} ts=${m.readyAt}`);

  const total = m.tapAt ? m.readyAt - m.tapAt : undefined;
  const navDelay = m.tapAt && m.navStartAt ? m.navStartAt - m.tapAt : undefined;
  const tapToFirstLayout =
    m.tapAt && m.firstLayoutAt ? m.firstLayoutAt - m.tapAt : undefined;
  const navToFirstLayout =
    m.navStartAt && m.firstLayoutAt ? m.firstLayoutAt - m.navStartAt : undefined;
  const listenerDelay =
    m.firstLayoutAt && m.screenMountAt ? m.screenMountAt - m.firstLayoutAt : undefined;
  const queryLoad = m.screenMountAt && m.messagesLoadedAt ? m.messagesLoadedAt - m.screenMountAt : undefined;
  const render = m.messagesLoadedAt ? m.readyAt - m.messagesLoadedAt : undefined;

  log(
    `CHAT_OPEN_TOTAL=${total ?? -1}ms chatId=${chatId} ` +
      `TAP_TO_NAV=${navDelay ?? -1}ms NAV_TO_FIRST_LAYOUT=${navToFirstLayout ?? -1}ms ` +
      `TAP_TO_FIRST_LAYOUT=${tapToFirstLayout ?? -1}ms LAYOUT_TO_LISTENER=${listenerDelay ?? -1}ms ` +
      `QUERY_LOAD=${queryLoad ?? -1}ms RENDER=${render ?? -1}ms`
  );
}

export function clearChatOpenMark(chatId: string) {
  if (!chatId) return;
  marks.delete(chatId);
}

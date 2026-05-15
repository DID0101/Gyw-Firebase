# Mobile performance notes (GYW)

This document summarizes **intentional** performance choices and where they live in code. It is not a substitute for profiling on real devices (Samsung / Redmi / Android 8–10).

## Measured / inferred bottlenecks (deep pass)

Use Metro logs in **dev** while opening a chat:

- `CHAT_PERF_*` lines from `lib/chatOpenPerf.ts` — read `CHAT_PERF_SUMMARY` at end of open.
- **Interpretation (code inspection + typical RN behavior):**
  - Large **tap→firstLayout** — JS thread busy in `ChatScreen` body, heavy selectors, or navigation transition cost.
  - Large **listenerStart→firstSnapshot** — Firestore/cold cache/network; ensure persistent cache is enabled (native: `@react-native-firebase/firestore` default; web SDK: `persistentLocalCache` in `lib/firebase.ts`).
  - Large **firstLayout→listLayout** — layout thrash, keyboard, or list not getting `flex`; also check **stale `messagesRef`** (fixed: ref now updates synchronously each render so inverted tail/cluster math matches current `messages`).
  - **Send path:** `assertChatSendAllowed` previously did **`getDoc(chats/{id})` / native participants read on every send** even when `chat.participants` was already in memory — removed on hot path via `participantsForSendGuard` on `SendChatMessageOptions`.
  - **Media send:** assert now runs **before** Storage upload to avoid wasted bandwidth when blocked.
- **FlashList:** Not migrated in this pass. Migrate only if Systrace/React DevTools shows FlatList `cell render` dominating CPU during scroll; inverted + `maintainVisibleContentPosition` + animated list must be re-validated.

## Optimistic text send + composer / keyboard (chat screen)

- **Optimistic insert** — `pending-*` row + clear composer in one `unstable_batchedUpdates` pass; **no `setSending(true)`** on text send (that swapped the send control for `ActivityIndicator` and caused visible composer row jump on Samsung/MIUI).
- **Firestore** — `sendMessage` runs inside **`InteractionManager.runAfterInteractions`** so the first paint + keyboard frame are not competing with the callable / Firestore write on the same JS turn.
- **Keyboard** — **No `Keyboard.dismiss`** and **no `focus()`** after send (both caused reopen / jump with `softwareKeyboardLayoutMode: "resize"` + edge-to-edge).
- **Scroll** — Removed the extra **200ms `scrollToOffset`** after send; **`suppressNextBottomScrollRef`** skips **one** auto-scroll from the `messages.length` effect right after optimistic prepend (avoids double scroll vs keyboard). Non-Android keeps **animated** scroll when auto-scrolling; Android uses **`animated: false`** for that path to reduce jank.
- **`KeyboardAvoidingView`** — **`enabled={Platform.OS !== 'android'}`** so Android uses **resize only** (see `app.json`); iOS keeps KAV to avoid fighting the window inset logic.

## Call start

- Header used **dynamic `import(callService)`** on each tap — **idle prefetch** of `@/lib/services/callService` when `chatId` mounts (`InteractionManager.runAfterInteractions`) plus existing tab `navigationPreload` chunk reduces first-tap latency.
- Native ring UI still dominated by `initiateCall` CF / `createCallNative`; measure with platform tools if still slow.

## Navigation & preloading

- **`lib/perf/navigationPreload.ts`** — After the Chats tab is focused, schedules **idle** dynamic imports for likely-next modules (`storyService`, profile modal). No hidden screen mounts, no full history preload.
- **Tabs** — `lazy: true` in `app/(home)/(tabs)/_layout.tsx` so inactive tabs do not mount until visited.
- **Chat route** — Existing `router.prefetch` + `warmChat` on navigation remain; **`warmChat` is deduped** per `chatId` in `lib/services/chatPreloadService.ts` to avoid overlapping fetches.

## Chat staged hydration (already present, extended)

- **Stage 1** — Header from `useChatStore` cache (`useLayoutEffect` in `app/(home)/chat/[id].tsx`); messages from MMKV-backed store; skeleton only when empty.
- **Stage 2** — Message `onSnapshot` starts after **one rAF** (Android) / **two rAFs** (iOS). On **API 26–28**, an extra **`InteractionManager.runAfterInteractions`** defers subscription so transitions finish under OEM GC pressure.
- **Stage 3** — Chat document + typing listener already deferred with `InteractionManager`; draft read deferred.

## Warm cache / startup

- **`lib/services/preloadService.ts`** — Stories and call history hydrate in **separate idle windows** (~40ms and ~220ms) so the first frame after sign-in is not competing with two Firestore reads.
- **Chats list** — Top **2** chats on API ≤29 (else **3**) warmed with a slightly longer delay and smaller page size to reduce RAM spikes.

## App resume

- **`app/(home)/_layout.tsx`** — Foreground presence write (`isOnline` / `lastActive`) is **debounced ~220ms** to avoid rapid active/blur churn; background still writes immediately.

## Images

- **`components/AppImage.tsx`** — Defaults: `cachePolicy="memory-disk"`, `recyclingKey` from URI when possible (better list recycling on Android).
- **Chat list avatars** — `imagePriority="low"` so in-room media can win decode bandwidth.

## FlatList

- **Chats** — On low-tier Android (API ≤29): lower `initialNumToRender`, `windowSize`, `maxToRenderPerBatch`, higher `updateCellsBatchingPeriod`.
- **Chat room** — On legacy Android (API 26–28): tighter `initialNumToRender` / `windowSize` / `maxToRenderPerBatch` in `ChatRoomBody`.

## JS thread — further audits (manual)

- Large synchronous sorts on huge message arrays — watch `chatPreloadService` merge path; keep ISO string compares where possible.
- **`useChats`** — Single listener; avoid adding per-chat listeners on the list screen.
- **Story viewer / video** — Heavy; keep modal-only and avoid importing `expo-video` on the chats tab path.

## OEM / low RAM

- Prefer **capped** warm windows (top-N chats, small message pages) over full history.
- **Do not** increase parallel Firestore listeners without measuring; message stream remains **one active listener** (`chatPreloadService`).

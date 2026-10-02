# Performance Audit & Optimization Report

**Scope:** Weak network (2G/3G), high latency, intermittent connectivity, low-end Android.  
**Goal:** WhatsApp-level *perceived* performance without architecture redesign.

---

## Phase 1 – Root Causes (ranked by impact)

### Firestore (highest cost)

| Issue | Files | Est. reads | Status |
|-------|-------|------------|--------|
| Unbounded `calls/` merge on every Calls tab focus | `callService.ts`, `firestoreNative.ts` | 50–500+ | **Partial fix:** `receiverId` query removed; `callerId`/`calleeId` now `limit(50)` |
| Global stories query (no cap) | `useStories.ts`, `firestoreNative.ts`, `storyService.ts` | O(all active stories) | **Fixed:** `limit(80)` on listener + preload |
| N+1 story view checks | `storyService.batchCheckStoryViewsForViewer` | 1× unseen stories | Open — batch `in` query recommended |
| Unbounded direct-chat lookup | `chatService.getOrCreateDirectChat`, `getOrCreateDirectChatNative` | 1× direct chats | **Fixed:** `limit(40)` |
| warmChat + listener duplicate reads | `chatPreloadService.ts`, `chats.tsx` | 20–30 per open | **Fixed:** skip warm when listener active; instant nav (prior pass) |
| Contact phone `in` batches (600 keys) | `userSearchService.ts`, `useContactRecommendedUsers.ts` | 20× 30-key chunks | **Fixed:** progressive batches + disk cache |
| Message rules `get(chats)` multiplier | `firestore.rules` | ~2× message reads | Open — rules simplification (server) |
| Full signaling subcollection listener | `callService.subscribeToSignaling` | 20–200/call | Open |

### React Native renders

| Issue | Files | Status |
|-------|-------|--------|
| Chat screen 37 `useState` — parent rerenders on keystroke (search/caption) | `chat/[id].tsx` | **Partial:** stable `onDismissOverlays` |
| Search screen full rerender per keystroke | `find-by-username.tsx` | Open — extract row component |
| Chats tab subscribes to full `chats` array | `useChats.ts` | Open |
| Missing memo on hot primitives | `Avatar`, `AppImage` | **Fixed:** `memo` applied |

### Images

| Issue | Files | Status |
|-------|-------|--------|
| Chat images full 1080px in list | `MessageBubble`, upload path | Open — thumb URLs at upload |
| `ImageViewer` used RN `Image` (no cache) | `ImageViewer.tsx` | **Fixed:** `expo-image` + `memory-disk` |
| Story image rings use full `mediaUrl` | `stories.tsx`, `storyService` | Open |

### Contacts

| Issue | Files | Status |
|-------|-------|--------|
| Duplicate device address-book scans | `contactsStore`, `useContactRecommendedUsers` | **Fixed:** stale gate + skip preload when disk fresh |
| 5-min RAM-only recommended cache | `useContactRecommendedUsers` | **Fixed:** AsyncStorage disk cache |
| Wait for all batches before UI | `useContactRecommendedUsers` | **Fixed:** progressive render after 2 chunks |

### Offline

| Issue | Files | Status |
|-------|-------|--------|
| Pending messages RAM-only | `chatStore`, `chat/[id].tsx` | **Fixed:** `messageOutbox.ts` + auto-retry on reconnect |
| Search results not on disk | `userSearchService` | Open (60s RAM cache exists) |
| Media send while offline | upload-first flow | Open |

### Startup

| Issue | Files | Status |
|-------|-------|--------|
| Auth blank frame on cold start | `app/index.tsx` | Open |
| Full contact scan on preload | `contactsStore.preloadContacts` | **Fixed:** skip when disk cache fresh |
| Stories/calls deferred preload | `preloadService.ts` | Already good (`runOnIdle`) |

### Audio / Audiobook (Phase 5)

**Not implemented in codebase.** Voice messages use stream-on-play (`AudioMessage.tsx`). Chapter pipeline N/A.

---

## Phase 2 – Chat Performance (implemented)

| Requirement | Implementation |
|-------------|----------------|
| Optimistic send | Already in `chat/[id].tsx` — `pending-*` before `sendMessage` |
| Instant open | Cache-first + skeleton; no pre-nav wait (`chats.tsx` prior fix) |
| Durable outbox | `lib/offline/messageOutbox.ts` — persist + flush on reconnect |
| Typing 60fps | Composer text isolated in `ChatMessageComposer`; typing debounced 350ms |
| Stable composer props | `dismissComposerOverlays` `useCallback` |

**Before:** Tap → 500ms stall → fade flash → skeleton 900ms  
**After (est.):** Tap → instant slide → cached messages or skeleton ≤450ms

---

## Phase 3 – Search & Contacts (implemented)

- **300ms** search debounce (`find-by-username.tsx`)
- **Progressive** contact recommendations: UI after batch 2 (~60 keys), background append
- **Disk cache** for recommendations (`recommendedUsersCache:v1`)
- **No redundant** device contact read when store index populated
- Phone `in` dedup + 60s cache (prior pass)

---

## Phase 4 – Images (partial)

- `ImageViewer`: expo-image disk cache
- `AppImage` / `Avatar`: memo + existing `cachePolicy` / `recyclingKey`
- **Remaining:** Generate `thumbnailUrl` at upload for chat images (requires Storage + schema change)

---

## Phase 6 – Offline (implemented)

- `enqueueOutboxMessage` on send
- `removeOutboxMessage` on success
- `startMessageOutboxRetryListener` in `app/(home)/_layout.tsx`
- Firestore native + web persistent cache (existing)
- MMKV message shards (existing)

---

## Phase 7 – Firestore read reductions (implemented)

| Collection | Query | Cap |
|------------|-------|-----|
| `stories` | `expiresAt > now` | 80 |
| `calls` | `callerId` / `calleeId` | `limitCount` (50) |
| `chats` | direct lookup | 40 |
| `users` | phone `in` | chunked 30, progressive |

---

## Phase 8 – Perf telemetry (implemented)

`lib/debug/perfTelemetry.ts`:
- `PERF_SCREEN_OPEN`
- `PERF_QUERY_START` / `PERF_QUERY_END`
- `PERF_RENDER_COUNT`
- `PERF_RERENDER_REASON`

Wired: `chat/[id].tsx` screen open. Extend to Search/Stories as needed.

Filter: `adb logcat *:E | findstr /i "PERF_"`

---

## Phase 9 – Startup

- Contacts preload skips device scan when disk index fresh (<30 min)
- Preload still deferred via `InteractionManager` / `runOnIdle`

**Target:** First screen <2s on low-end Android — measure with `PERF_SCREEN_OPEN` + `BUILD_INFO` logs.

---

## Files changed (this pass)

| File | Change |
|------|--------|
| `lib/debug/perfTelemetry.ts` | New perf logging |
| `lib/offline/messageOutbox.ts` | Durable send queue |
| `lib/hooks/useContactRecommendedUsers.ts` | Progressive + disk cache |
| `lib/services/userSearchService.ts` | `onBatch` progressive callback |
| `store/contactsStore.ts` | Skip fresh disk preload |
| `lib/firestoreNative.ts` | Stories/calls/direct limits |
| `lib/hooks/useStories.ts` | Stories limit |
| `lib/services/storyService.ts` | Stories limit |
| `lib/services/chatService.ts` | Direct chat limit |
| `lib/services/chatPreloadService.ts` | Skip warm when listener active |
| `components/ImageViewer.tsx` | expo-image cache |
| `components/AppImage.tsx`, `Avatar.tsx` | memo |
| `app/(home)/chat/[id].tsx` | Outbox, perf, stable overlays |
| `app/(home)/_layout.tsx` | Outbox retry listener |
| `app/(home)/(modal)/find-by-username.tsx` | 300ms debounce |

---

## Remaining bottlenecks

1. Chat image thumbnails at upload (biggest media win)
2. Chat screen split into smaller subscribed children (biggest render win)
3. Firestore message rules `get(chats)` double-read
4. `getCallHistory` web path still unbounded on `calls/`
5. Story view N+1 `getDoc` checks
6. Search row memo + isolated TextInput state
7. Audiobook chapter pipeline (feature not present)

---

## Validation checklist

1. Airplane mode → send text → kill app → online → message sends (`OUTBOX_FLUSH_*` logs)
2. Search screen → recommendations appear before all batches complete (`RECOMMENDED_PROGRESSIVE`)
3. Stories tab on 2G → ≤80 reads in logs
4. Open chat on 2G → no 500ms tap stall; cached messages instant
5. Full-screen image → second open uses cache (no network spike)

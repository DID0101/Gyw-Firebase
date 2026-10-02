# Search & Recommended Users — Play Store vs Debug Report

**Screen:** `app/(home)/(modal)/find-by-username.tsx`  
**Search service:** `lib/services/userSearchService.ts`  
**Recommended hook:** `lib/hooks/useContactRecommendedUsers.ts`  
**Contacts cache:** `store/contactsStore.ts`

---

## ROOT CAUSE

| # | Root cause | Severity |
|---|------------|----------|
| **1** | **Production silences `console.log`** — all prior `SEARCH_LOAD` logs used `console.log` (`searchLoadingTrace.ts` L78), wiped by `app/_layout.tsx` **L29–34** in release | **Critical for diagnosis** |
| **2** | **Firestore errors swallowed as empty results** — phone batch queries catch and continue (`userSearchService.ts` **L160–165**, **L194–199**) | **High** |
| **3** | **Exact-match only** — `username ==` and `phoneNumber in` require stored value to match a query variant exactly; no fuzzy search | **High** |
| **4** | **Phone format mismatch** — user docs store signup `formatPhone()` value (`sign-up.tsx` **L34–37**); Firestore `in` must hit one of `buildPhoneLookupKeys()` strings (`phoneNormalization.ts` **L79–141**) | **High** |
| **5** | **Contacts permission denied / empty on Play** — fresh installs, OEM privacy; `READ_CONTACTS` in `app.json` **L53** but user can deny | **High (recommended)** |
| **6** | **Overlapping recommended sync + stale `finishLoading`** — parallel `sync()` when `currentUid` hydrates; superseded gen skipped `finishLoading` in `finally` (fixed: always `finishLoading` in `finally`) | **Medium (infinite spinner)** |
| **7** | **Region default `US` when locale has no region** — `getDeviceRegionCode()` **L13–16** `phoneNormalize.ts` mis-parses TR numbers on some devices | **Medium** |
| **8** | **Not missing Firestore indexes** — single-field `in` / `==` on `users` need no composite index (`firestore.indexes.json` has none for `users`; automatic indexes suffice) | N/A |
| **9** | **Not rules split by build** — `users` read = `isSignedIn()` (`firestore.rules` **L41–42**) — same debug & Play; fails if auth token not ready | **Medium** |
| **10** | **No dynamic import on search path** — search is static imports; not a Play-only failure mode | N/A |

---

## WHY DEBUG WORKS

1. **`console.log` visible** — Metro shows `SEARCH_LOAD`, Firestore errors, contact permission logs.
2. **Developers often test signed-in, English/US locale, contacts already granted** on dev device.
3. **Debug keystore + same device** — repeated testing with known phone/username formats.
4. **Hot reload / single mount** — fewer overlapping `sync()` generations than cold-start Play + auth hydration.
5. **Errors throw visibly** in Metro when not caught (username path throws; phone path swallows).

---

## WHY PLAY STORE FAILS

1. **Logs invisible** — looked like “nothing happens” while Firestore returned `permission-denied` or empty chunks.
2. **`permission-denied` / network errors** on phone `in` queries → caught → **0 results**, no UI error (`userSearchService.ts` **L160–165**).
3. **Stored `phoneNumber` not in candidate list** — e.g. profile `+90…` vs query chunk missing variant → empty search.
4. **Username search** requires sanitized `base_XX` (`unicodeText.ts` **L61–71**, **L178–181**) — searching without `_12` suffix returns nothing.
5. **Contacts denied** → `RECOMMENDED_USERS_EMPTY` / spinner until timeout (`useContactRecommendedUsers.ts` **L194–203**, **L174–178**).
6. **Stale contact cache** (`contactsStore.ts` **L122–127**) with empty map → `keys.length === 0` → no recommended (`useContactRecommendedUsers.ts` **L244–248**).
7. **Some devices** slower `getContactsAsync` / stricter permissions → longer loading, more timeouts.

---

## MINIMAL FIX (no architecture change)

| Fix | File | Lines | Action |
|-----|------|-------|--------|
| **A** | `lib/debug/searchLoadingTrace.ts` | **73–88** | ✅ Use `console.error` + canonical tags (Play-visible) |
| **B** | `lib/hooks/useContactRecommendedUsers.ts` | **finally** | ✅ Always `finishLoading` — prevents infinite `recLoading` |
| **C** | `lib/services/userSearchService.ts` | **160–165, 194–199** | Log `SEARCH_FIRESTORE_ERROR` with `code` (done); optional: surface one Alert if all chunks fail with `permission-denied` |
| **D** | `lib/services/userSearchService.ts` | **323–365** | On phone search miss, log `PHONE_SEARCH_MISS` with candidates count (already) |
| **E** | User profile writes | `sign-up.tsx` **34–37** | Normalize `phoneNumber` to E.164 via `normalizePhoneNumber()` before `prepareUserDocFields` (one-line) |
| **F** | `useContactRecommendedUsers.ts` | **244–248** | If `keys.length === 0` && permission granted, call `refreshContacts()` once (existing store API) |
| **G** | Play testing | — | `adb logcat *:E \| findstr SEARCH_ CONTACT_ RECOMMENDED_ LOADING_` on release APK |

---

## EXACT FILES / FUNCTIONS / LINES

### Infinite loading

| Symptom | File | Function | Lines |
|---------|------|----------|-------|
| Search spinner stuck | `find-by-username.tsx` | `runQuery` / `clearSearchBusy` | **160–171** timeout, **190–194** finally |
| Recommended spinner stuck | `find-by-username.tsx` | `listHeader` | **307–312** when `recLoading` |
| Recommended `loading` never cleared | `useContactRecommendedUsers.ts` | `sync` `finally` | **302–305** (was gen-gated; **fixed**) |
| Recommended 10s cap | `useContactRecommendedUsers.ts` | `sync` timeout | **174–178** |

### Search returns nothing (username)

| File | Function | Lines | Why empty |
|------|----------|-------|-----------|
| `userSearchService.ts` | `getUserByUsernameExact` | **295–317** | Tries `usernameQueryCandidates` — Firestore **exact** `==` |
| `userSearchService.ts` | `getUserByUsernameNative` | **270–293** | Native query |
| `userSearchService.ts` | `searchUsersByUsernameOrPhone` | **359–365** | Non-phone branch |
| `unicodeText.ts` | `sanitizeUsernameBase` | **61–71** | Lowercase `en-US` — query must match stored username |

### Search returns nothing (phone)

| File | Function | Lines | Why empty |
|------|----------|-------|-----------|
| `userSearchService.ts` | `searchUsersByUsernameOrPhone` | **341–356** | `looksLikePhoneQuery` + `phoneQueryCandidates` |
| `phoneNormalize.ts` | `phoneQueryCandidates` | **45–50** | Builds IN list |
| `userSearchService.ts` | `getUsersByPhoneChunkNative` | **111–137** | `where('phoneNumber','in',chunk)` |
| `userSearchService.ts` | `getUsersByPhoneInNative` | **189–199** | **Errors swallowed** → empty |
| `phoneNormalization.ts` | `buildPhoneLookupKeys` | **79–141** | Variants must match stored field |

### Recommended users empty

| File | Function | Lines | Why empty |
|------|----------|-------|-----------|
| `useContactRecommendedUsers.ts` | `sync` | **194–203** | Permission denied |
| `useContactRecommendedUsers.ts` | `keysFromContactsCache` | **71–89** | Empty `phoneToName` |
| `useContactRecommendedUsers.ts` | `sync` | **244–248** | `keys.length === 0` |
| `useContactRecommendedUsers.ts` | `sync` | **255–277** | Firestore IN returned 0 matches |
| `contactsStore.ts` | `readDeviceContacts` | **86–94** | Permission denied |
| `contactsStore.ts` | `hydrateFromStorage` | **122–127** | Empty persisted index |

### Firestore rules / indexes

| Item | File | Lines |
|------|------|-------|
| Users read | `firestore.rules` | **41–42** `allow read: if isSignedIn()` |
| No users phone/username composite index required | `firestore.indexes.json` | (none for `users`) |

### Production-only logging (was broken)

| File | Function | Lines |
|------|----------|-------|
| `searchLoadingTrace.ts` | `searchLoadLog` | **73–88** — was `console.log` |
| `app/_layout.tsx` | module init | **29–34** — disables log/warn in release |

---

## Instrumentation (added)

All tags emit via **`console.error`** → visible on Play Store.

**Filter:**

```bash
adb logcat *:E | findstr /i "SEARCH_ CONTACT_ RECOMMENDED_ LOADING_"
```

| Tag | Emitted from |
|-----|----------------|
| `SEARCH_SCREEN_MOUNT` | `find-by-username.tsx` **80** |
| `SEARCH_INITIALIZATION_*` | `find-by-username.tsx` **81–88**, `useContactRecommendedUsers.ts` **169+** |
| `SEARCH_START` / `SEARCH_QUERY` | `find-by-username.tsx` **163–164**, `userSearchService.ts` **336–337** |
| `SEARCH_FIRESTORE_REQUEST/RESPONSE/ERROR` | `userSearchService.ts` **94–136, 257, 160–165** |
| `SEARCH_RESULT_COUNT` | `find-by-username.tsx` **182**, `userSearchService.ts` **353** |
| `CONTACT_SYNC_*` | `useContactRecommendedUsers.ts` **170+** |
| `CONTACT_PERMISSION_STATUS` | `useContactRecommendedUsers.ts` **194** |
| `RECOMMENDED_USERS_*` | `useContactRecommendedUsers.ts` |
| `LOADING_START` / `LOADING_END` | `find-by-username.tsx`, `useContactRecommendedUsers.ts` |

---

## What to look for on a failing Play device

1. **`SEARCH_FIRESTORE_ERROR` `code":"permission-denied"`** → auth not attached to RN Firestore before search.
2. **`CONTACT_PERMISSION_STATUS` `granted":false`** → recommended empty; not a Firestore bug.
3. **`RECOMMENDED_USERS_EMPTY` `no_keys`** → contacts cache empty; run contact sync / grant permission.
4. **`PHONE_SEARCH_MISS`** with `candidates > 0` → stored profile phones don’t match normalized keys (**fix E**).
5. **`LOADING_END` missing** → infinite spinner (should be fixed by **finally** always clearing).
6. **`SEARCH_TIMEOUT`** repeating → slow network or too many phone chunks (600 keys max).

---

*No architecture changes. Search system unchanged; instrumentation + one loading-state fix + Play-safe logging.*

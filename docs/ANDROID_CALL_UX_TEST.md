# Android incoming call UX — manual QA matrix

Run after native/plugin changes:

```bash
npx expo prebuild --clean
npx expo run:android --variant release
```

Prefer a **release** build on at least one API 26–28 device and one OEM (Xiaomi/Oppo/Tecno) if available.

## Prerequisites

- Two test accounts; caller initiates **audio** and **video** calls separately.
- `POST_NOTIFICATIONS` granted on API 33+.
- Custom ringtone present: `assets/sounds/ringtone.wav` → `android/app/src/main/res/raw/ringtone.wav` after prebuild.

## Per scenario checklist

For each cell below, verify:

| Check | Expected |
|-------|----------|
| UI mode | Audio: phone icon + “Incoming voice call”. Video: camera icon + “VIDEO” pill + blue ring. |
| Ringtone | Custom app tone (not system default) |
| Single ring | Exactly **one** audible ring (no channel + alerts double) |
| Stop latency | Ring stops within ~300 ms on accept/decline |
| Timeout | No ring after 30–45 s dismiss / remote cancel |
| Actions | Notification + full-screen accept opens `gyw://call/...` |

## Matrix

### Audio call

| State | Action | Pass? |
|-------|--------|-------|
| App open | Accept | |
| App open | Decline | |
| Background | Accept | |
| Background | Decline | |
| Killed | Accept (notification) | |
| Killed | Decline | |
| Lock screen | Full-screen accept | |
| Lock screen | Decline | |
| Any | Wait timeout (~30 s) | |
| Any | Caller cancels while ringing | |

### Video call

| State | Action | Pass? |
|-------|--------|-------|
| App open | Accept | |
| App open | Decline | |
| Background | Accept | |
| Background | Decline | |
| Killed | Accept (notification) | |
| Killed | Decline | |
| Lock screen | Full-screen accept | |
| Lock screen | Decline | |
| Any | Wait timeout (~30 s) | |
| Any | Caller cancels while ringing | |

## Log tags (debug builds)

- `GywFcmService` — FCM dispatch
- `GywIncomingCallAlerts` — ringtone URI + cleanup
- `GywIncomingCallNotifier` — channel `call_channel_v3`, silent notification
- `GywIncomingCallService` — FGS + heads-up vs full-screen
- `IncomingCallActivity` — lock-screen UI

## Known upgrade note

Users who had `call_channel_v2` (with sound) may need one app update; v3 is silent and v2 is deleted on first incoming call after upgrade.

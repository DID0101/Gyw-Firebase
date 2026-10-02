# Android low-end device test matrix

Target: API **24–29**, 2–3 GB RAM (2017-era and budget phones). Run **`npx expo run:android --variant release`** for realistic perf.

## Scenarios

| Scenario | Pass criteria |
|----------|----------------|
| Cold start → Chats tab | Interactive within ~2s; no long white freeze |
| Open chat (2nd time, Wi‑Fi) | Messages visible in &lt;100ms; no skeleton |
| Open chat (1st time, 2G throttle) | Press-in warm; list fills before/with first snapshot |
| Chats scroll (50+ rows) | No sustained JS frame drops |
| Chat scroll (100+ messages) | Scroll usable; no ANR |
| Airplane mode, last chat | Cached thread + offline banner |
| Send text while keyboard open | No composer jump (Android resize mode) |
| Incoming call (app killed) | Native ring UI (GMS device) |

## DEV metrics

Watch Metro for:

- `CHAT_PERF_CACHE_HIT`
- `CHAT_PERF_WARM_DONE`
- `CHAT_PERF_SUMMARY` (tap→firstLayout, warmMs, listenerStart→firstSnapshot)

## Profiler

Android Studio → CPU profiler on release build while opening chat and scrolling.

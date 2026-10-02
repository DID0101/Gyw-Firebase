# Stories Native Ads Implementation

Google AdMob **native ads** are integrated in the **Stories viewer swipe flow** (full-screen slides). The horizontal story ring row on the Stories tab shows only real users — ads appear between story slides when viewing stories.

## Files modified / added

| Path | Role |
|------|------|
| `app/(home)/(modal)/story-viewer.tsx` | Inserts sponsored slides into the swipe viewer with shared progress bars |
| `lib/hooks/useStoryViewerAds.ts` | Preloads ads, assigns slots, lifecycle cleanup |
| `lib/stories/storyViewerFeed.ts` | Viewer feed model + insertion strategy (every 3–5 slides) |
| `lib/stories/storyAdManager.ts` | Singleton preload pool, consent gate, session cleanup |
| `lib/stories/storyAdConfig.ts` | Android ad unit ID (env override) |
| `lib/stories/storyAdConsent.ts` | GDPR / UMP consent before ad requests |
| `lib/stories/storyAdPreferences.ts` | Optional “reduce ads” preference (AsyncStorage) |
| `lib/stories/storyAdLog.ts` | Release-safe `STORY_AD_*` diagnostics |
| `components/stories/StoryViewerAdSlide.tsx` | Full-screen native ad story card |
| `components/stories/StoryViewerAdSkeleton.tsx` | Shimmer placeholder (optional loading state) |
| `__tests__/storyViewerAdPlacement.test.ts` | Viewer placement unit tests |
| `app.json` | AdMob app ID plugin |
| `.env.local` | Production native ad unit ID |

## Ad insertion strategy (viewer)

1. User opens a person's story viewer and swipes through their slides.
2. If there are **fewer than 3** real story slides, **no ads**.
3. Otherwise insert a sponsored slide **after every 3–5 real slides** (deterministic interval from slide count).
4. At least **2 real slides** always separate ads (no consecutive ad slides).
5. Slots render **only when a native ad is preloaded** — failed loads are skipped silently.
6. Users swipe/tap through ads like normal stories (left/right tap, auto-advance timer).

## UI / UX

- Full-screen story dimensions with top progress segments (includes ad slides).
- **Sponsored** label + subtle border (AdMob policy).
- Ad media, headline, body, and CTA button via `NativeAdView`.
- Skip (X) and tap-to-advance; long-press pauses the timer like regular stories.
- Like/reply actions hidden on ad slides.
- Dark/light theme aware styling.

## Performance

- Preload pool (up to 3 ads) via `storyAdManager`.
- Tab-press prefetch still warms the pool before opening viewer.
- Story loading never waits on ads.
- `AppState` background → destroy pool; foreground → prefetch again.
- Viewer unmount destroys assigned `NativeAd` instances.

## Configuration

```bash
EXPO_PUBLIC_ADMOB_ANDROID_STORY_NATIVE_AD_UNIT_ID=ca-app-pub-9450348713978628/9375482044
```

AdMob app ID in `app.json`: `ca-app-pub-9450348713978628~3244677218`

Requires a **native dev/production build** (not Expo Go).

## Diagnostics

Filter logcat / Metro: `STORY_AD`

| Tag | When |
|-----|------|
| `STORY_AD_REQUEST` | Load started |
| `STORY_AD_LOADED` | Ready in pool |
| `STORY_AD_FAILED` | Load error (slide omitted) |
| `STORY_AD_RENDERED` | Viewer ad slide mounted |
| `STORY_AD_IMPRESSION` | Impression recorded |
| `STORY_AD_CLICKED` | User tapped ad |

## Testing checklist

- [ ] Open viewer with **3+ story slides** from one user
- [ ] Sponsored slide appears after 3–5 slides when ad loads
- [ ] Swipe/tap past ad like a normal story
- [ ] Long-press pauses ad timer
- [ ] Failed ad load → next real slide with no spinner/error
- [ ] Like/reply hidden on ad slides
- [ ] `STORY_AD_*` logs in Metro/logcat
- [ ] Rebuild after changing `.env.local`

## app-ads.txt / AdMob account

See earlier sections in this doc for `app-ads.txt` hosting and payment/account approval requirements.

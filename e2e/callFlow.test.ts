/**
 * e2e/callFlow.test.ts
 *
 * Detox E2E tests for the incoming-call notification flow.
 *
 * Coverage
 * ────────
 *   • App receives an FCM data-only push while foregrounded
 *   • Incoming-call screen appears with caller info
 *   • Tapping Accept navigates to the active call screen
 *   • Tapping Decline dismisses the incoming-call screen
 *   • App handles a CALL_CANCELLED push and dismisses automatically
 *   • App cold-launches from a notification (killed-state delivery)
 *
 * Prerequisites
 * ─────────────
 *   • `detox build --configuration <cfg>` must pass before running.
 *   • Android: `adb` in PATH; emulator booted or device connected.
 *   • iOS: Simulator booted; bundle ID com.tropicolx.signal-clone.
 *   • Environment variable GYW_TEST_FCM_TOKEN must be set to a valid
 *     FCM registration token for the device/emulator under test.
 *     On Android you can grab it with: adb shell am broadcast \
 *       -a com.gyw1.chat.GET_FCM_TOKEN
 *
 * Run
 * ───
 *   npx detox test --configuration ios.sim.debug   -t "incoming call"
 *   npx detox test --configuration android.emu.debug
 */

import { device, element, by, expect as dExpect, waitFor } from 'detox';

// ── Payload builders ─────────────────────────────────────────────────────

interface IncomingCallData {
  callId?:      string;
  callerId?:    string;
  callerName?:  string;
  callerAvatar?: string;
  callType?:    'audio' | 'video';
}

function incomingCallPayload(opts: IncomingCallData = {}) {
  return {
    type:         'INCOMING_CALL',
    callId:       opts.callId       ?? 'e2e-call-uuid-001',
    callerId:     opts.callerId     ?? 'e2e-caller-uid',
    callerName:   opts.callerName   ?? 'E2E Caller',
    callerAvatar: opts.callerAvatar ?? '',
    callType:     opts.callType     ?? 'audio',
  };
}

function cancelPayload(callId = 'e2e-call-uuid-001') {
  return {
    type:     'CALL_CANCELLED',
    callId,
    callerId: 'e2e-caller-uid',
  };
}

// ── Platform helpers ─────────────────────────────────────────────────────

const IS_IOS     = device.getPlatform() === 'ios';
const IS_ANDROID = device.getPlatform() === 'android';

/**
 * Simulate an FCM data-only push arriving at the running app.
 *
 * iOS  — uses `device.sendUserNotification` with `content-available:1`
 *         so RN's messaging handler fires (not a UNUserNotification alert).
 * Android — uses `device.sendIntentBroadcast` via am broadcast to the
 *            GywFirebaseMessagingService receiver, or falls back to
 *            `device.sendUserNotification` shim.
 */
async function simulatePush(data: Record<string, string>): Promise<void> {
  if (IS_IOS) {
    await device.sendUserNotification({
      trigger: { type: 'push' },
      payload: {
        aps: { 'content-available': 1 },
        ...data,
      },
    });
  } else {
    // Android: trigger via adb intent to the debug broadcast receiver
    // The receiver must be registered in the debug build manifest:
    //   <receiver android:name=".debug.DetoxPushReceiver" />
    // It converts extras into a RemoteMessage and routes to onMessageReceived.
    await device.sendUserNotification({
      payload: { data },
    });
  }
}

// ── Shared setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Fresh install ensures a clean notification permission state
  await device.launchApp({ newInstance: true, delete: true });
});

afterAll(async () => {
  await device.terminateApp();
});

// ══════════════════════════════════════════════════════════════════════════
// Suite 1 — Incoming call while app is foregrounded
// ══════════════════════════════════════════════════════════════════════════

describe('incoming call — foreground', () => {
  beforeEach(async () => {
    await device.reloadReactNative();
  });

  afterEach(async () => {
    // Cancel any lingering call so the next test starts clean
    await simulatePush(cancelPayload());
    await new Promise((r) => setTimeout(r, 500));
  });

  // ── Appearance ──────────────────────────────────────────────────────────

  it('shows the incoming-call screen when a push arrives', async () => {
    await simulatePush(incomingCallPayload({ callerName: 'Alice Test' }));

    // iOS static route; Android navigates to /(home)/call/[id]
    if (IS_IOS) {
      await waitFor(element(by.id('incoming-call-screen')))
        .toBeVisible()
        .withTimeout(6_000);
    } else {
      await waitFor(element(by.id('call-screen')))
        .toBeVisible()
        .withTimeout(6_000);
    }
  });

  it('displays the caller name', async () => {
    await simulatePush(incomingCallPayload({ callerName: 'Alice Test' }));

    await waitFor(element(by.text('Alice Test')))
      .toBeVisible()
      .withTimeout(6_000);
  });

  it('shows accept and decline buttons', async () => {
    await simulatePush(incomingCallPayload());

    if (IS_IOS) {
      await waitFor(element(by.id('incoming-call-screen')))
        .toBeVisible()
        .withTimeout(6_000);

      await dExpect(element(by.id('btn-accept-call'))).toBeVisible();
      await dExpect(element(by.id('btn-decline-call'))).toBeVisible();
    }
  });

  // ── Accept flow ─────────────────────────────────────────────────────────

  it('navigates to the active call screen on Accept', async () => {
    await simulatePush(incomingCallPayload({ callId: 'e2e-accept-001', callerName: 'Bob Accept' }));

    if (IS_IOS) {
      await waitFor(element(by.id('incoming-call-screen')))
        .toBeVisible()
        .withTimeout(6_000);

      await element(by.id('btn-accept-call')).tap();
    } else {
      await waitFor(element(by.id('call-screen')))
        .toBeVisible()
        .withTimeout(6_000);

      await element(by.id('btn-accept-call')).tap();
    }

    // Both platforms navigate to the call screen after answering
    await waitFor(element(by.id('active-call-screen')))
      .toBeVisible()
      .withTimeout(8_000);
  });

  // ── Decline flow ────────────────────────────────────────────────────────

  it('dismisses the incoming-call screen on Decline', async () => {
    await simulatePush(incomingCallPayload({ callId: 'e2e-decline-001' }));

    if (IS_IOS) {
      await waitFor(element(by.id('incoming-call-screen')))
        .toBeVisible()
        .withTimeout(6_000);

      await element(by.id('btn-decline-call')).tap();

      await waitFor(element(by.id('incoming-call-screen')))
        .not.toBeVisible()
        .withTimeout(4_000);
    } else {
      await waitFor(element(by.id('call-screen')))
        .toBeVisible()
        .withTimeout(6_000);

      await element(by.id('btn-decline-call')).tap();

      await waitFor(element(by.id('call-screen')))
        .not.toBeVisible()
        .withTimeout(4_000);
    }
  });

  // ── Auto-cancel ─────────────────────────────────────────────────────────

  it('auto-dismisses when CALL_CANCELLED arrives', async () => {
    await simulatePush(incomingCallPayload({ callId: 'e2e-cancel-001' }));

    if (IS_IOS) {
      await waitFor(element(by.id('incoming-call-screen')))
        .toBeVisible()
        .withTimeout(6_000);
    } else {
      await waitFor(element(by.id('call-screen')))
        .toBeVisible()
        .withTimeout(6_000);
    }

    // Send cancellation push
    await simulatePush(cancelPayload('e2e-cancel-001'));

    if (IS_IOS) {
      await waitFor(element(by.id('incoming-call-screen')))
        .not.toBeVisible()
        .withTimeout(5_000);
    } else {
      await waitFor(element(by.id('call-screen')))
        .not.toBeVisible()
        .withTimeout(5_000);
    }
  });

  // ── Video call variant ───────────────────────────────────────────────────

  it('shows video-call indicator for video call type', async () => {
    await simulatePush(incomingCallPayload({ callType: 'video', callerName: 'Charlie Video' }));

    await waitFor(element(by.text('Charlie Video')))
      .toBeVisible()
      .withTimeout(6_000);

    // Look for a video-specific label (testID set in incoming.tsx)
    if (IS_IOS) {
      await dExpect(element(by.id('call-type-video'))).toBeVisible();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Suite 2 — Incoming call while app is backgrounded
// ══════════════════════════════════════════════════════════════════════════

describe('incoming call — background', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  afterEach(async () => {
    await simulatePush(cancelPayload());
    await new Promise((r) => setTimeout(r, 500));
    await device.launchApp({ newInstance: false });
  });

  it('brings the app to foreground and shows call screen', async () => {
    // Send app to background
    await device.sendToHome();
    await new Promise((r) => setTimeout(r, 800));

    await simulatePush(incomingCallPayload({ callerName: 'Dave Background' }));
    await new Promise((r) => setTimeout(r, 1_500));

    // Bring app back
    await device.launchApp({ newInstance: false });

    if (IS_IOS) {
      await waitFor(element(by.id('incoming-call-screen')))
        .toBeVisible()
        .withTimeout(8_000);

      await waitFor(element(by.text('Dave Background')))
        .toBeVisible()
        .withTimeout(4_000);
    } else {
      await waitFor(element(by.id('call-screen')))
        .toBeVisible()
        .withTimeout(8_000);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Suite 3 — Cold-launch from notification (killed state)
// ══════════════════════════════════════════════════════════════════════════

describe('incoming call — killed state', () => {
  it('launches into the call screen when tapped from the system UI', async () => {
    await device.terminateApp();
    await new Promise((r) => setTimeout(r, 1_000));

    // On iOS the system will display a CallKit incoming-call UI automatically
    // when a VoIP push arrives; we simulate the user tapping Accept by
    // launching with the notification payload as if they tapped the banner.
    // On Android the full-screen intent or HeadsUpNotification is displayed;
    // we simulate launch with the notification extras.
    await device.launchApp({
      newInstance:   true,
      userNotification: {
        payload: {
          aps: { 'content-available': 1 },
          type:       'INCOMING_CALL',
          callId:     'e2e-killed-001',
          callerId:   'killer-uid',
          callerName: 'Eve Killed',
          callType:   'audio',
        },
      },
    });

    if (IS_IOS) {
      // After launch the incoming screen (or call screen if auto-answered)
      // should be visible within a reasonable timeout
      await waitFor(
        element(by.id('incoming-call-screen'))
          .withAncestor(by.id('root-navigator'))
      )
        .toBeVisible()
        .withTimeout(10_000);
    } else {
      await waitFor(element(by.id('call-screen')))
        .toBeVisible()
        .withTimeout(10_000);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Suite 4 — Edge cases
// ══════════════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  beforeEach(async () => {
    await device.reloadReactNative();
  });

  afterEach(async () => {
    await simulatePush(cancelPayload());
    await new Promise((r) => setTimeout(r, 300));
  });

  it('ignores a CALL_CANCELLED for a different callId', async () => {
    await simulatePush(incomingCallPayload({ callId: 'our-call' }));

    if (IS_IOS) {
      await waitFor(element(by.id('incoming-call-screen')))
        .toBeVisible()
        .withTimeout(6_000);
    }

    // Cancel a different call — our screen should remain visible
    await simulatePush(cancelPayload('other-call'));
    await new Promise((r) => setTimeout(r, 1_500));

    if (IS_IOS) {
      await dExpect(element(by.id('incoming-call-screen'))).toBeVisible();
    }
  });

  it('handles a duplicate INCOMING_CALL push gracefully (no double screen)', async () => {
    await simulatePush(incomingCallPayload({ callId: 'dup-001' }));
    await simulatePush(incomingCallPayload({ callId: 'dup-001' })); // same callId

    if (IS_IOS) {
      await waitFor(element(by.id('incoming-call-screen')))
        .toBeVisible()
        .withTimeout(6_000);

      // Only one incoming-call screen should exist
      await dExpect(element(by.id('incoming-call-screen'))).toBeVisible();
      // Verify we can still interact normally
      await dExpect(element(by.id('btn-accept-call'))).toBeVisible();
    }
  });
});

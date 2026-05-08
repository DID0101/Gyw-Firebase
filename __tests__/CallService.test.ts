/**
 * __tests__/CallService.test.ts
 *
 * Unit tests for lib/callkeep.ts — the RNCallKeep JS wrapper.
 *
 * Strategy
 * ────────
 *   • RNCallKeep native module is fully mocked in jest.setup.ts.
 *   • Platform.OS is overridden per-describe block.
 *   • callManagerStore is mocked to isolate CallService logic.
 *   • Each test resets module state (teardownCallKeep + jest.clearAllMocks).
 */

import { Platform } from 'react-native';

// ── Store mock — must be before importing callkeep ────────────────────────
const mockOnCallAnswered = jest.fn();
const mockOnCallEnded    = jest.fn();
const mockClearCall      = jest.fn();

jest.mock('@/store/callManagerStore', () => ({
  useCallManagerStore: {
    getState: jest.fn(() => ({
      onCallAnswered: mockOnCallAnswered,
      onCallEnded:    mockOnCallEnded,
      clearCall:      mockClearCall,
    })),
  },
}));

// ── Subject under test ────────────────────────────────────────────────────
import {
  setupCallKeep,
  teardownCallKeep,
  displayIncomingCall,
  startOutgoingCall,
  answerIncomingCall,
  endCall,
  rejectCall,
  reportCallEnded,
} from '@/lib/callkeep';

// ── RNCallKeep mock handle ────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RNCallKeep = require('react-native-callkeep').default as jest.Mocked<{
  setup:               jest.Mock;
  addEventListener:    jest.Mock;
  removeEventListener: jest.Mock;
  displayIncomingCall: jest.Mock;
  startCall:           jest.Mock;
  answerIncomingCall:  jest.Mock;
  endCall:             jest.Mock;
  rejectCall:          jest.Mock;
  setAvailable:        jest.Mock;
}>;

// Fake expo-router Router shape
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() } as any;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Reset all mocks and tear down callkeep between tests. */
async function freshSetup(platform: 'ios' | 'android' = 'ios'): Promise<void> {
  jest.clearAllMocks();
  teardownCallKeep();
  (Platform as any).OS = platform;
  await setupCallKeep(mockRouter);
}

/** Return the handler registered for a specific CallKeep event. */
function capturedHandler(eventName: string): ((...args: any[]) => void) | undefined {
  const calls = RNCallKeep.addEventListener.mock.calls;
  const found  = calls.find(([ev]) => ev === eventName);
  return found?.[1] as ((...args: any[]) => void) | undefined;
}

// ══════════════════════════════════════════════════════════════════════════
// setup / teardown
// ══════════════════════════════════════════════════════════════════════════

describe('setupCallKeep', () => {
  afterEach(() => teardownCallKeep());

  it('calls RNCallKeep.setup with max-calls=1 options', async () => {
    (Platform as any).OS = 'ios';
    await setupCallKeep(mockRouter);

    expect(RNCallKeep.setup).toHaveBeenCalledTimes(1);
    const [opts] = RNCallKeep.setup.mock.calls[0] as [any];
    expect(opts.ios.maximumCallGroups).toBe('1');
    expect(opts.ios.maximumCallsPerCallGroup).toBe('1');
    expect(opts.android.selfManaged).toBe(true);
  });

  it('registers all required event listeners', async () => {
    (Platform as any).OS = 'ios';
    await setupCallKeep(mockRouter);

    const registered = RNCallKeep.addEventListener.mock.calls.map(([ev]) => ev as string);
    expect(registered).toContain('answerCall');
    expect(registered).toContain('endCall');
    expect(registered).toContain('didReceiveStartCallAction');
    expect(registered).toContain('didPerformDTMFAction');
    expect(registered).toContain('didToggleHoldCallAction');
    expect(registered).toContain('didActivateAudioSession');
  });

  it('registers showIncomingCallUi only on Android', async () => {
    (Platform as any).OS = 'android';
    await setupCallKeep(mockRouter);

    const registered = RNCallKeep.addEventListener.mock.calls.map(([ev]) => ev as string);
    expect(registered).toContain('showIncomingCallUi');
  });

  it('calls setAvailable(true) only on iOS', async () => {
    (Platform as any).OS = 'ios';
    await setupCallKeep(mockRouter);
    expect(RNCallKeep.setAvailable).toHaveBeenCalledWith(true);

    teardownCallKeep();
    jest.clearAllMocks();
    (Platform as any).OS = 'android';
    await setupCallKeep(mockRouter);
    expect(RNCallKeep.setAvailable).not.toHaveBeenCalled();
  });

  it('is idempotent — second setup() is a no-op', async () => {
    (Platform as any).OS = 'ios';
    await setupCallKeep(mockRouter);
    await setupCallKeep(mockRouter); // second call

    expect(RNCallKeep.setup).toHaveBeenCalledTimes(1);
    expect(RNCallKeep.addEventListener).toHaveBeenCalledTimes(
      // iOS: 6 standard + NO showIncomingCallUi
      6,
    );
  });

  it('is a no-op on web', async () => {
    (Platform as any).OS = 'web';
    await setupCallKeep(mockRouter);
    expect(RNCallKeep.setup).not.toHaveBeenCalled();
  });
});

describe('teardownCallKeep', () => {
  it('removes all event listeners', async () => {
    (Platform as any).OS = 'ios';
    await setupCallKeep(mockRouter);
    teardownCallKeep();
    expect(RNCallKeep.removeEventListener).toHaveBeenCalledWith('answerCall');
    expect(RNCallKeep.removeEventListener).toHaveBeenCalledWith('endCall');
  });

  it('allows re-setup after teardown', async () => {
    (Platform as any).OS = 'ios';
    await setupCallKeep(mockRouter);
    teardownCallKeep();
    jest.clearAllMocks();

    await setupCallKeep(mockRouter);
    expect(RNCallKeep.setup).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// startOutgoingCall
// ══════════════════════════════════════════════════════════════════════════

describe('startOutgoingCall', () => {
  beforeEach(() => freshSetup('ios'));
  afterEach(() => teardownCallKeep());

  it('calls RNCallKeep.startCall with correct arguments for audio', () => {
    startOutgoingCall('call-uuid-1', 'Alice', 'audio');
    expect(RNCallKeep.startCall).toHaveBeenCalledWith(
      'call-uuid-1',
      'Alice',
      'Alice',
      'generic',
      false, // hasVideo
    );
  });

  it('sets hasVideo=true for video call', () => {
    startOutgoingCall('call-uuid-2', 'Bob', 'video');
    const args = RNCallKeep.startCall.mock.calls[0];
    expect(args[4]).toBe(true);
  });

  it('uses callId as the first argument (UUID)', () => {
    startOutgoingCall('my-specific-uuid', 'Charlie', 'audio');
    expect(RNCallKeep.startCall.mock.calls[0][0]).toBe('my-specific-uuid');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// displayIncomingCall
// ══════════════════════════════════════════════════════════════════════════

describe('displayIncomingCall', () => {
  afterEach(() => teardownCallKeep());

  it('calls RNCallKeep.displayIncomingCall on iOS', async () => {
    await freshSetup('ios');
    displayIncomingCall('call-xyz', 'Dana', 'audio');
    expect(RNCallKeep.displayIncomingCall).toHaveBeenCalledWith(
      'call-xyz',
      'Dana',
      'generic',
      false,
      'Dana',
    );
  });

  it('does not call RNCallKeep.displayIncomingCall on Android (native Telecom owns incoming)', async () => {
    await freshSetup('android');
    displayIncomingCall('call-xyz', 'Dana', 'audio');
    expect(RNCallKeep.displayIncomingCall).not.toHaveBeenCalled();
  });

  it('passes hasVideo=true for video calls', async () => {
    await freshSetup('ios');
    displayIncomingCall('call-vid', 'Eve', 'video');
    const args = RNCallKeep.displayIncomingCall.mock.calls[0];
    expect(args[3]).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// answerIncomingCall
// ══════════════════════════════════════════════════════════════════════════

describe('answerIncomingCall', () => {
  beforeEach(() => freshSetup('ios'));
  afterEach(() => teardownCallKeep());

  it('delegates to RNCallKeep.answerIncomingCall', () => {
    answerIncomingCall('answer-uuid');
    expect(RNCallKeep.answerIncomingCall).toHaveBeenCalledWith('answer-uuid');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// endCall / reportCallEnded
// ══════════════════════════════════════════════════════════════════════════

describe('endCall / reportCallEnded', () => {
  beforeEach(() => freshSetup('ios'));
  afterEach(() => teardownCallKeep());

  it('endCall delegates to RNCallKeep.endCall', () => {
    endCall('end-uuid');
    expect(RNCallKeep.endCall).toHaveBeenCalledWith('end-uuid');
  });

  it('reportCallEnded is an alias for endCall', () => {
    reportCallEnded('report-uuid');
    expect(RNCallKeep.endCall).toHaveBeenCalledWith('report-uuid');
  });

  it('endCall is safe even if RNCallKeep throws', async () => {
    RNCallKeep.endCall.mockImplementationOnce(() => { throw new Error('native crash'); });
    expect(() => endCall('crash-uuid')).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// rejectCall
// ══════════════════════════════════════════════════════════════════════════

describe('rejectCall', () => {
  beforeEach(() => freshSetup('ios'));
  afterEach(() => teardownCallKeep());

  it('calls RNCallKeep.rejectCall', () => {
    rejectCall('reject-uuid');
    expect(RNCallKeep.rejectCall).toHaveBeenCalledWith('reject-uuid');
  });

  it('falls back to endCall if rejectCall throws', () => {
    RNCallKeep.rejectCall.mockImplementationOnce(() => { throw new Error('not supported'); });
    rejectCall('fallback-uuid');
    expect(RNCallKeep.endCall).toHaveBeenCalledWith('fallback-uuid');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Event handler callbacks → callManagerStore
// ══════════════════════════════════════════════════════════════════════════

describe('callKeep event handlers → store', () => {
  beforeEach(() => freshSetup('ios'));
  afterEach(() => teardownCallKeep());

  it('answerCall event calls store.onCallAnswered', () => {
    const handler = capturedHandler('answerCall');
    expect(handler).toBeDefined();
    handler!({ callUUID: 'ans-uuid' });
    expect(mockOnCallAnswered).toHaveBeenCalledWith('ans-uuid');
  });

  it('endCall event calls store.onCallEnded', () => {
    const handler = capturedHandler('endCall');
    handler!({ callUUID: 'end-uuid' });
    expect(mockOnCallEnded).toHaveBeenCalledWith('end-uuid');
  });

  it('answerCall event fires the onAnswerCall callback', async () => {
    teardownCallKeep();
    jest.clearAllMocks();
    const onAnswer = jest.fn();
    await setupCallKeep(mockRouter, onAnswer);

    const handler = capturedHandler('answerCall');
    handler!({ callUUID: 'cb-uuid' });
    expect(onAnswer).toHaveBeenCalledWith('cb-uuid');
  });

  it('endCall event fires the onEndCall callback', async () => {
    teardownCallKeep();
    jest.clearAllMocks();
    const onEnd = jest.fn();
    await setupCallKeep(mockRouter, undefined, onEnd);

    const handler = capturedHandler('endCall');
    handler!({ callUUID: 'cb-end' });
    expect(onEnd).toHaveBeenCalledWith('cb-end');
  });

  it('answerCall navigates to call screen with accept=1', async () => {
    teardownCallKeep();
    jest.clearAllMocks();
    const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() } as any;
    await setupCallKeep(router);

    const handler = capturedHandler('answerCall');
    handler!({ callUUID: 'nav-uuid' });
    expect(router.push).toHaveBeenCalledWith(
      expect.stringContaining('nav-uuid'),
    );
    expect(router.push).toHaveBeenCalledWith(
      expect.stringContaining('accept=1'),
    );
  });
});

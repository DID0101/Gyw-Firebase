/**
 * __tests__/NotificationService.test.ts
 *
 * Unit tests for lib/services/NotificationService.ts
 *
 * Strategy
 * ────────
 *   • lib/callkeep is fully mocked so we can assert it was called.
 *   • FCM is wake-only: no Zustand updates from NotificationService.
 *   • @react-native-firebase/messaging is mocked in jest.setup.ts.
 *   • Platform.OS is controlled per-describe block.
 *   • handleRemoteMessage is the primary entry point under test.
 */

import { Platform } from 'react-native';

// ── callkeep mock ─────────────────────────────────────────────────────────
const mockDisplayIncomingCall = jest.fn();
const mockEndCall              = jest.fn();
const mockEndAllCalls          = jest.fn();
const mockShowIncomingCallScreen = jest.fn();

jest.mock('@/lib/callkeep', () => ({
  displayIncomingCall: mockDisplayIncomingCall,
  endCall:             mockEndCall,
  endAllCalls:         mockEndAllCalls,
}));

jest.mock('@/lib/call/incomingCallGuard', () => ({
  shouldShowIncomingCall: jest.fn().mockReturnValue(true),
  shouldShowIncomingCallAsync: jest.fn().mockResolvedValue(true),
  toGuardDataFromFcm: jest.fn((callId: string, createdAt: number) => ({
    callId,
    status: 'ringing',
    createdAt,
  })),
}));

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    NativeModules: {
      ...RN.NativeModules,
      IncomingCallModule: {
        showIncomingCallScreen: mockShowIncomingCallScreen,
        dismissIncomingCallScreen: jest.fn(),
      },
    },
  };
});

// ── Subject under test ────────────────────────────────────────────────────
import {
  handleRemoteMessage,
  setupForegroundHandler,
  setupBackgroundHandler,
} from '@/lib/services/NotificationService';

// ── Helpers ───────────────────────────────────────────────────────────────

function msg(data: Record<string, string>, messageId = 'msg-1') {
  return { messageId, data };
}

function incomingPayload(overrides: Partial<Record<string, string>> = {}) {
  return {
    type:         'INCOMING_CALL',
    callId:       'call-uuid-001',
    callerId:     'caller-uid',
    callerName:   'Alice',
    callerAvatar: 'https://example.com/alice.jpg',
    callType:     'audio',
    ...overrides,
  };
}

function cancelPayload(callId = 'call-uuid-001'): Record<string, string> {
  return {
    type:     'CALL_CANCELLED',
    callId,
    callerId: 'caller-uid',
  };
}

// ══════════════════════════════════════════════════════════════════════════
// handleRemoteMessage — INCOMING_CALL
// ══════════════════════════════════════════════════════════════════════════

describe('handleRemoteMessage — INCOMING_CALL', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as any).OS = 'ios';
  });

  it('calls displayIncomingCall on iOS (wake only)', async () => {
    await handleRemoteMessage(msg(incomingPayload()));
    expect(mockDisplayIncomingCall).toHaveBeenCalledWith('call-uuid-001', 'Alice', 'audio');
  });

  it('does not duplicate native incoming UI on Android (FCM service owns ring)', async () => {
    (Platform as any).OS = 'android';
    await handleRemoteMessage(msg(incomingPayload()));
    expect(mockShowIncomingCallScreen).not.toHaveBeenCalled();
    expect(mockDisplayIncomingCall).not.toHaveBeenCalled();
  });

  it('handles video callType correctly', async () => {
    await handleRemoteMessage(msg(incomingPayload({ callType: 'video' })));
    expect(mockDisplayIncomingCall).toHaveBeenCalledWith(
      'call-uuid-001',
      'Alice',
      'video',
    );
  });

  it('accepts type=call (lowercase alias)', async () => {
    await handleRemoteMessage(msg(incomingPayload({ type: 'call' })));
    expect(mockDisplayIncomingCall).toHaveBeenCalled();
  });

  it('accepts type=incoming_call (snake_case alias)', async () => {
    await handleRemoteMessage(msg(incomingPayload({ type: 'incoming_call' })));
    expect(mockDisplayIncomingCall).toHaveBeenCalled();
  });

  it('does not call endCall for INCOMING_CALL', async () => {
    await handleRemoteMessage(msg(incomingPayload()));
    expect(mockEndCall).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// handleRemoteMessage — CALL_CANCELLED / call_ended
// ══════════════════════════════════════════════════════════════════════════

describe('handleRemoteMessage — CALL_CANCELLED', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as any).OS = 'ios';
  });

  it('dismisses native call UI', async () => {
    await handleRemoteMessage(msg(cancelPayload()));
    expect(mockEndCall).toHaveBeenCalledWith('call-uuid-001');
    expect(mockEndAllCalls).toHaveBeenCalled();
  });

  it('accepts call_cancelled (lowercase alias)', async () => {
    await handleRemoteMessage(msg({ type: 'call_cancelled', callId: 'call-uuid-001' }));
    expect(mockEndCall).toHaveBeenCalledWith('call-uuid-001');
  });

  it('accepts call_ended alias', async () => {
    await handleRemoteMessage(msg({ type: 'call_ended', callId: 'c-x' }));
    expect(mockEndCall).toHaveBeenCalledWith('c-x');
  });

  it('accepts incoming_call_cancelled alias', async () => {
    await handleRemoteMessage(msg({ type: 'incoming_call_cancelled', callId: 'c-y' }));
    expect(mockEndCall).toHaveBeenCalledWith('c-y');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// handleRemoteMessage — malformed / edge cases
// ══════════════════════════════════════════════════════════════════════════

describe('handleRemoteMessage — malformed payloads', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does nothing if data is undefined', () => {
    expect(() => handleRemoteMessage({ messageId: 'x' })).not.toThrow();
    expect(mockEndCall).not.toHaveBeenCalled();
    expect(mockDisplayIncomingCall).not.toHaveBeenCalled();
  });

  it('does nothing if data is null', () => {
    expect(() => handleRemoteMessage({ messageId: 'x', data: undefined })).not.toThrow();
  });

  it('does nothing if callId is missing from INCOMING_CALL', async () => {
    await handleRemoteMessage(msg({ type: 'INCOMING_CALL', callerName: 'No ID' }));
    expect(mockDisplayIncomingCall).not.toHaveBeenCalled();
  });

  it('does nothing if callId is missing from CALL_CANCELLED', async () => {
    await handleRemoteMessage(msg({ type: 'CALL_CANCELLED' }));
    expect(mockEndCall).not.toHaveBeenCalled();
  });

  it('ignores chat_message (native notifier owns Android UI)', async () => {
    await handleRemoteMessage(
      msg({
        type: 'chat_message',
        chatId: 'chat-1',
        senderId: 'u1',
        senderName: 'Sam',
        text: 'hi',
        messageId: 'm1',
      }),
    );
    expect(mockDisplayIncomingCall).not.toHaveBeenCalled();
  });

  it('does nothing for an unknown type', async () => {
    await handleRemoteMessage(msg({ type: 'WEIRD_TYPE', callId: 'x', body: 'hi' }));
    expect(mockDisplayIncomingCall).not.toHaveBeenCalled();
  });

  it('does nothing if the message has no data key', () => {
    expect(() =>
      handleRemoteMessage({ messageId: 'no-data', notification: { title: 'Hi' } })
    ).not.toThrow();
  });

  it('defaults callType to audio when missing', async () => {
    (Platform as any).OS = 'ios';
    await handleRemoteMessage(msg({ type: 'INCOMING_CALL', callId: 'c-no-type', callerName: 'X' }));
    expect(mockDisplayIncomingCall).toHaveBeenCalledWith('c-no-type', 'X', 'audio');
  });

  it('defaults callerName when missing', async () => {
    (Platform as any).OS = 'ios';
    await handleRemoteMessage(msg({ type: 'INCOMING_CALL', callId: 'c-no-name' }));
    expect(mockDisplayIncomingCall).toHaveBeenCalledWith('c-no-name', 'Incoming call', 'audio');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// setupForegroundHandler
// ══════════════════════════════════════════════════════════════════════════

describe('setupForegroundHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as any).OS = 'ios';
  });

  it('returns a cleanup function', () => {
    const cleanup = setupForegroundHandler();
    expect(typeof cleanup).toBe('function');
  });

  it('calls messaging().onMessage', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mockMessaging = require('@react-native-firebase/messaging').default as jest.Mock;
    setupForegroundHandler();
    const instance = mockMessaging.mock.results[0]?.value;
    expect(instance?.onMessage).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on web', () => {
    (Platform as any).OS = 'web';
    const cleanup = setupForegroundHandler();
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });

  it('dispatches incoming call through handleRemoteMessage when foreground message arrives', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mockMessaging = require('@react-native-firebase/messaging').default as jest.Mock;
    let capturedHandler: ((msg: any) => void) | null = null;

    mockMessaging.mockReturnValueOnce({
      onMessage: jest.fn((h) => { capturedHandler = h; return jest.fn(); }),
      setBackgroundMessageHandler: jest.fn(),
      getToken: jest.fn().mockResolvedValue('t'),
    });

    setupForegroundHandler();

    // Trigger the handler
    capturedHandler?.({
      messageId: 'fg-1',
      data: {
        type:      'INCOMING_CALL',
        callId:    'fg-call',
        callerName: 'Bob',
        callType:  'audio',
      },
    });

    expect(mockDisplayIncomingCall).toHaveBeenCalledWith('fg-call', 'Bob', 'audio');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// setupBackgroundHandler
// ══════════════════════════════════════════════════════════════════════════

describe('setupBackgroundHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as any).OS = 'android';
  });

  it('calls messaging().setBackgroundMessageHandler', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mockMessaging = require('@react-native-firebase/messaging').default as jest.Mock;
    setupBackgroundHandler();
    const instance = mockMessaging.mock.results[0]?.value;
    expect(instance?.setBackgroundMessageHandler).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on web', () => {
    (Platform as any).OS = 'web';
    expect(() => setupBackgroundHandler()).not.toThrow();
  });
});

/**
 * __tests__/NotificationService.test.ts
 *
 * Unit tests for lib/services/NotificationService.ts
 *
 * Strategy
 * ────────
 *   • lib/callkeep is fully mocked so we can assert it was called.
 *   • store/callManagerStore is mocked with jest spies so we can
 *     assert setIncomingCall / clearCall were called with correct args.
 *   • @react-native-firebase/messaging is mocked in jest.setup.ts.
 *   • Platform.OS is controlled per-describe block.
 *   • handleRemoteMessage is the primary entry point under test.
 */

import { Platform } from 'react-native';

// ── callkeep mock ─────────────────────────────────────────────────────────
const mockDisplayIncomingCall = jest.fn();
const mockEndCall              = jest.fn();

jest.mock('@/lib/callkeep', () => ({
  displayIncomingCall: mockDisplayIncomingCall,
  endCall:             mockEndCall,
}));

// ── callManagerStore mock ────────────────────────────────────────────────
const mockSetIncomingCall = jest.fn();
const mockClearCall       = jest.fn();
let   mockIncomingCall: any = null;

jest.mock('@/store/callManagerStore', () => ({
  useCallManagerStore: {
    getState: jest.fn(() => ({
      setIncomingCall: mockSetIncomingCall,
      clearCall:       mockClearCall,
      incomingCall:    mockIncomingCall,
    })),
  },
}));

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
    mockIncomingCall = null;
    (Platform as any).OS = 'ios';
  });

  it('sets incomingCall in the store', () => {
    handleRemoteMessage(msg(incomingPayload()));

    expect(mockSetIncomingCall).toHaveBeenCalledTimes(1);
    const arg = mockSetIncomingCall.mock.calls[0][0];
    expect(arg.callId).toBe('call-uuid-001');
    expect(arg.callerName).toBe('Alice');
    expect(arg.callType).toBe('audio');
    expect(arg.callerId).toBe('caller-uid');
    expect(arg.callerAvatar).toBe('https://example.com/alice.jpg');
  });

  it('calls displayIncomingCall with correct params', () => {
    handleRemoteMessage(msg(incomingPayload()));
    expect(mockDisplayIncomingCall).toHaveBeenCalledWith('call-uuid-001', 'Alice', 'audio');
  });

  it('does not call displayIncomingCall on Android (native Telecom + activity)', () => {
    (Platform as any).OS = 'android';
    handleRemoteMessage(msg(incomingPayload()));
    expect(mockSetIncomingCall).toHaveBeenCalledTimes(1);
    expect(mockDisplayIncomingCall).not.toHaveBeenCalled();
  });

  it('handles video callType correctly', () => {
    handleRemoteMessage(msg(incomingPayload({ callType: 'video' })));
    const arg = mockSetIncomingCall.mock.calls[0][0];
    expect(arg.callType).toBe('video');
    expect(mockDisplayIncomingCall).toHaveBeenCalledWith(
      'call-uuid-001',
      'Alice',
      'video',
    );
  });

  it('accepts type=call (lowercase alias)', () => {
    handleRemoteMessage(msg(incomingPayload({ type: 'call' })));
    expect(mockSetIncomingCall).toHaveBeenCalled();
    expect(mockDisplayIncomingCall).toHaveBeenCalled();
  });

  it('accepts type=incoming_call (snake_case alias)', () => {
    handleRemoteMessage(msg(incomingPayload({ type: 'incoming_call' })));
    expect(mockSetIncomingCall).toHaveBeenCalled();
  });

  it('uses snake_case key variants for callerId / callerName', () => {
    handleRemoteMessage(msg({
      type:         'INCOMING_CALL',
      callId:       'call-uuid-002',
      caller_id:    'uid-snake',
      caller_name:  'Bob Snake',
      callType:     'audio',
    }));
    const arg = mockSetIncomingCall.mock.calls[0][0];
    expect(arg.callerId).toBe('uid-snake');
    expect(arg.callerName).toBe('Bob Snake');
  });

  it('does NOT set callerAvatar if empty string', () => {
    handleRemoteMessage(msg(incomingPayload({ callerAvatar: '' })));
    const arg = mockSetIncomingCall.mock.calls[0][0];
    expect(arg.callerAvatar).toBeUndefined();
  });

  it('does not call endCall or clearCall for INCOMING_CALL', () => {
    handleRemoteMessage(msg(incomingPayload()));
    expect(mockEndCall).not.toHaveBeenCalled();
    expect(mockClearCall).not.toHaveBeenCalled();
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

  it('clears the store and ends the call', () => {
    mockIncomingCall = { callId: 'call-uuid-001' };
    handleRemoteMessage(msg(cancelPayload()));
    expect(mockClearCall).toHaveBeenCalledTimes(1);
    expect(mockEndCall).toHaveBeenCalledWith('call-uuid-001');
  });

  it('accepts call_cancelled (lowercase alias)', () => {
    mockIncomingCall = { callId: 'call-uuid-001' };
    handleRemoteMessage(msg({ type: 'call_cancelled', callId: 'call-uuid-001' }));
    expect(mockClearCall).toHaveBeenCalled();
    expect(mockEndCall).toHaveBeenCalledWith('call-uuid-001');
  });

  it('accepts call_ended alias', () => {
    mockIncomingCall = { callId: 'c-x' };
    handleRemoteMessage(msg({ type: 'call_ended', callId: 'c-x' }));
    expect(mockEndCall).toHaveBeenCalledWith('c-x');
  });

  it('accepts incoming_call_cancelled alias', () => {
    mockIncomingCall = { callId: 'c-y' };
    handleRemoteMessage(msg({ type: 'incoming_call_cancelled', callId: 'c-y' }));
    expect(mockEndCall).toHaveBeenCalledWith('c-y');
  });

  it('does NOT clear store if cancel is for a different callId', () => {
    // A CALL_CANCELLED for a different call should not affect our current state
    mockIncomingCall = { callId: 'our-call' };
    handleRemoteMessage(msg({ type: 'CALL_CANCELLED', callId: 'other-call' }));
    expect(mockClearCall).not.toHaveBeenCalled();
    expect(mockEndCall).not.toHaveBeenCalled();
  });

  it('clears store if no call is currently tracked (null)', () => {
    mockIncomingCall = null;
    handleRemoteMessage(msg(cancelPayload('any-id')));
    expect(mockClearCall).toHaveBeenCalled();
    expect(mockEndCall).toHaveBeenCalledWith('any-id');
  });

  it('does NOT call setIncomingCall for a cancel payload', () => {
    mockIncomingCall = { callId: 'call-uuid-001' };
    handleRemoteMessage(msg(cancelPayload()));
    expect(mockSetIncomingCall).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// handleRemoteMessage — malformed / edge cases
// ══════════════════════════════════════════════════════════════════════════

describe('handleRemoteMessage — malformed payloads', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does nothing if data is undefined', () => {
    expect(() => handleRemoteMessage({ messageId: 'x' })).not.toThrow();
    expect(mockSetIncomingCall).not.toHaveBeenCalled();
    expect(mockClearCall).not.toHaveBeenCalled();
    expect(mockEndCall).not.toHaveBeenCalled();
  });

  it('does nothing if data is null', () => {
    expect(() => handleRemoteMessage({ messageId: 'x', data: undefined })).not.toThrow();
  });

  it('does nothing if callId is missing from INCOMING_CALL', () => {
    handleRemoteMessage(msg({ type: 'INCOMING_CALL', callerName: 'No ID' }));
    expect(mockSetIncomingCall).not.toHaveBeenCalled();
  });

  it('does nothing if callId is missing from CALL_CANCELLED', () => {
    handleRemoteMessage(msg({ type: 'CALL_CANCELLED' }));
    expect(mockClearCall).not.toHaveBeenCalled();
    expect(mockEndCall).not.toHaveBeenCalled();
  });

  it('ignores chat_message (native notifier owns Android UI)', () => {
    handleRemoteMessage(
      msg({
        type: 'chat_message',
        chatId: 'chat-1',
        senderId: 'u1',
        senderName: 'Sam',
        text: 'hi',
        messageId: 'm1',
      }),
    );
    expect(mockSetIncomingCall).not.toHaveBeenCalled();
    expect(mockClearCall).not.toHaveBeenCalled();
  });

  it('does nothing for an unknown type', () => {
    handleRemoteMessage(msg({ type: 'WEIRD_TYPE', callId: 'x', body: 'hi' }));
    expect(mockSetIncomingCall).not.toHaveBeenCalled();
    expect(mockClearCall).not.toHaveBeenCalled();
  });

  it('does nothing if the message has no data key', () => {
    expect(() =>
      handleRemoteMessage({ messageId: 'no-data', notification: { title: 'Hi' } })
    ).not.toThrow();
  });

  it('defaults callType to audio when missing', () => {
    handleRemoteMessage(msg({ type: 'INCOMING_CALL', callId: 'c-no-type', callerName: 'X' }));
    const arg = mockSetIncomingCall.mock.calls[0][0];
    expect(arg.callType).toBe('audio');
  });

  it('defaults callerName when missing', () => {
    handleRemoteMessage(msg({ type: 'INCOMING_CALL', callId: 'c-no-name' }));
    const arg = mockSetIncomingCall.mock.calls[0][0];
    expect(arg.callerName).toBe('Incoming call');
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

    expect(mockSetIncomingCall).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'fg-call', callerName: 'Bob' })
    );
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

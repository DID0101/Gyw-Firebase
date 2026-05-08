/**
 * jest.setup.ts
 * Runs after the test framework is installed. Establishes globals and
 * module-level mocks that every test file inherits.
 */

// ── Globals RN bundles expect ─────────────────────────────────────────────
(global as any).__DEV__ = true;

// ── Silence specific console noise from RN internals ─────────────────────
const IGNORED_WARNINGS = [
  'Warning: An update to',
  'Warning: ReactDOM.render',
  'NativeEventEmitter',
];

const _consoleWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && IGNORED_WARNINGS.some((w) => args[0].startsWith(w))) {
    return;
  }
  _consoleWarn(...args);
};

// ── react-native-callkeep ────────────────────────────────────────────────
jest.mock('react-native-callkeep', () => ({
  default: {
    setup:               jest.fn().mockResolvedValue(undefined),
    addEventListener:    jest.fn(),
    removeEventListener: jest.fn(),
    displayIncomingCall: jest.fn(),
    startCall:           jest.fn(),
    answerIncomingCall:  jest.fn(),
    endCall:             jest.fn(),
    rejectCall:          jest.fn(),
    setAvailable:        jest.fn(),
    registerPhoneAccount: jest.fn(),
  },
}));

// ── @react-native-firebase/messaging ────────────────────────────────────
jest.mock('@react-native-firebase/messaging', () => {
  const onMessage = jest.fn((_handler: any) => jest.fn()); // returns unsub
  const setBackgroundMessageHandler = jest.fn();
  const getToken = jest.fn().mockResolvedValue('mock-fcm-token-xyz');

  return {
    default: jest.fn(() => ({
      onMessage,
      setBackgroundMessageHandler,
      getToken,
    })),
  };
});

// ── react-native-incall-manager ──────────────────────────────────────────
jest.mock('react-native-incall-manager', () => ({
  default: {
    start:            jest.fn(),
    stop:             jest.fn(),
    startRingtone:    jest.fn(),
    stopRingtone:     jest.fn(),
    setSpeakerphoneOn: jest.fn(),
  },
}));

// ── @react-native-async-storage/async-storage ───────────────────────────
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// ── expo-router ──────────────────────────────────────────────────────────
jest.mock('expo-router', () => ({
  useRouter:             jest.fn(() => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() })),
  useLocalSearchParams:  jest.fn(() => ({})),
  usePathname:           jest.fn(() => '/'),
}));

// ── AuthContext ───────────────────────────────────────────────────────────
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    user:    { uid: 'test-user-uid', displayName: 'Test User' },
    loading: false,
    signOut: jest.fn(),
  })),
}));

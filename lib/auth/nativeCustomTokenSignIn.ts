import { getRnAuth } from '@/lib/rnFirebase';
import { prodDebugError } from '@/lib/debug/prodDebug';

export async function signInNativeWithCustomToken(
  customToken: string,
): Promise<{ uid: string; phoneNumber: string | null }> {
  const authInstance = getRnAuth();
  if (!authInstance) {
    throw new Error('Native Firebase Auth is not initialized');
  }

  const authMod = require('@react-native-firebase/auth');
  const attempts: Array<() => Promise<{ user?: { uid: string; phoneNumber: string | null } }>> = [];

  if (typeof authMod.signInWithCustomToken === 'function') {
    attempts.push(() => authMod.signInWithCustomToken(authInstance, customToken));
  }
  if (typeof authInstance.signInWithCustomToken === 'function') {
    attempts.push(() => authInstance.signInWithCustomToken(customToken));
  }
  if (typeof authMod.default === 'function') {
    attempts.push(async () => {
      const legacy = authMod.default();
      return legacy.signInWithCustomToken(customToken);
    });
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const credential = await attempt();
      const user = credential?.user ?? authInstance.currentUser;
      if (user?.uid) {
        return { uid: user.uid, phoneNumber: user.phoneNumber ?? null };
      }
    } catch (e) {
      lastError = e;
      prodDebugError('AUTH_CUSTOM_TOKEN_SIGNIN_ATTEMPT_FAILED', e);
    }
  }

  prodDebugError('AUTH_CUSTOM_TOKEN_SIGNIN_FAILED', lastError ?? new Error('no attempts'));
  throw Object.assign(
    new Error(
      lastError instanceof Error
        ? lastError.message
        : 'Custom token sign-in failed. Request a new code and try again.',
    ),
    { code: (lastError as { code?: string })?.code ?? 'auth/internal-error' },
  );
}

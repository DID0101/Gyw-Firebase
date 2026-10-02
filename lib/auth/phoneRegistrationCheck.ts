import { Platform } from 'react-native';

import { functions, httpsCallable } from '@/lib/firebase';

import { callNativeCallable } from './nativeCallableRest';

export type PhoneAuthIntent = 'signIn' | 'signUp';

type CheckRequest = { phoneNumber: string; intent: PhoneAuthIntent };
type CheckResponse = { registered: boolean };

async function invokeCheckPhoneRegistration(payload: CheckRequest): Promise<CheckResponse> {
  if (Platform.OS === 'web') {
    const fn = httpsCallable<CheckRequest, CheckResponse>(functions, 'checkPhoneRegistration');
    const { data } = await fn(payload);
    return data;
  }
  return callNativeCallable<CheckRequest, CheckResponse>('checkPhoneRegistration', payload);
}

function toClientError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** Reject sign-in for unregistered phones / sign-up for existing phones (server Firestore lookup). */
export async function assertPhoneAllowedForAuth(
  phoneNumber: string,
  intent: PhoneAuthIntent,
): Promise<void> {
  try {
    await invokeCheckPhoneRegistration({ phoneNumber, intent });
  } catch (error) {
    const e = error as { code?: string; message?: string };
    const code = e?.code ?? '';
    const message = e?.message ?? '';

    if (code === 'auth/account-not-found') {
      throw error;
    }
    if (code === 'auth/account-already-exists') {
      throw error;
    }
    if (code === 'functions/failed-precondition' && message.includes('No account found')) {
      throw toClientError('auth/account-not-found', message);
    }
    if (
      code === 'functions/already-exists' ||
      (code === 'functions/failed-precondition' && message.includes('already exists'))
    ) {
      throw toClientError('auth/account-already-exists', message);
    }

    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        '[auth] checkPhoneRegistration unavailable; using post-verify profile gate',
        code || message.slice(0, 80),
      );
    }
  }
}

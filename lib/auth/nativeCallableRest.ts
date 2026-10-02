import { Platform } from 'react-native';

import { app } from '@/lib/firebase';

function mapCallableError(name: string, status: string | undefined, message: string | undefined): Error & { code: string } {
  const normalized = (status ?? 'INTERNAL').toUpperCase();
  const msg = message ?? `Callable ${name} failed`;

  if (msg.includes('INVALID_CODE') || msg.includes('INVALID_VERIFICATION_CODE')) {
    return Object.assign(new Error('Wrong verification code.'), { code: 'auth/invalid-verification-code' });
  }
  if (msg.includes('SESSION_EXPIRED') || msg.includes('INVALID_SESSION_INFO')) {
    return Object.assign(new Error('Code expired. Request a new one.'), { code: 'auth/session-expired' });
  }

  const code =
    normalized === 'FAILED_PRECONDITION'
      ? 'functions/failed-precondition'
      : normalized === 'NOT_FOUND'
        ? 'functions/not-found'
        : normalized === 'ALREADY_EXISTS'
          ? 'functions/already-exists'
          : normalized === 'RESOURCE_EXHAUSTED'
            ? 'functions/resource-exhausted'
            : normalized === 'UNAUTHENTICATED'
              ? 'functions/unauthenticated'
              : 'functions/internal';
  return Object.assign(new Error(msg), { code });
}

/** RN modular httpsCallable can return spurious not-found; REST matches deployed v1 callables. */
export async function callNativeCallable<TReq, TRes>(
  name: string,
  data: TReq,
  options?: { idToken?: string | null },
): Promise<TRes> {
  if (Platform.OS === 'web') {
    throw new Error('callNativeCallable is native-only');
  }

  const { getApp } = require('@react-native-firebase/app');
  const rnApp = getApp();
  const projectId = rnApp?.options?.projectId ?? app?.options?.projectId ?? 'gyw1-146d7';
  const url = `https://us-central1-${projectId}.cloudfunctions.net/${name}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options?.idToken) {
    headers.Authorization = `Bearer ${options.idToken}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  });
  const rawText = await res.text();
  let json: { result?: TRes; error?: { message?: string; status?: string } };
  try {
    json = JSON.parse(rawText);
  } catch {
    throw Object.assign(new Error(`Callable ${name} returned non-JSON (${res.status})`), {
      code: 'internal',
    });
  }
  if (json.error) {
    throw mapCallableError(name, json.error.status, json.error.message);
  }
  if (json.result === undefined) {
    throw Object.assign(new Error(`Callable ${name} returned no result`), { code: 'internal' });
  }
  return json.result;
}

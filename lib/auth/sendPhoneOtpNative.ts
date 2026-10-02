import { NativeModules, Platform } from 'react-native';

import { configurePhoneAuthForNumber } from '@/lib/auth/androidPhoneAuthDev';
import { prodDebug, prodDebugError } from '@/lib/debug/prodDebug';
import { ensureAuthUiReady } from '@/lib/auth/ensureAuthUiReady';
import { logAndroidAuthEnvironment } from '@/lib/auth/androidAuthEnvironment';
import { getRegisteredSha1FingerprintsForPackage } from '@/lib/auth/googleServicesShaIndex';
import { prepareAndroidPhoneAuth, warnIfNoScreenLock, clearAndroidPhoneAuthCrypto } from '@/lib/auth/phoneAuthNativePrepare';
import { clearPhoneLoginSession, setPhoneLoginSession } from '@/lib/auth/phoneLoginSession';
import { getRnAuth } from '@/lib/rnFirebase';

type PhoneAuthDiagnosticsNative = {
  getSigningFingerprints?: () => Promise<{ sha1: string[]; sha256: string[] }>;
  getAuthActivitySnapshot?: () => Promise<{
    currentActivity: string;
    playServicesStatus: number;
    resumedActivity: string;
  }>;
};

function normalizeSha(input: string): string {
  return input.toLowerCase().replace(/:/g, '');
}

function logAuth(tag: string, data?: unknown): void {
  if (!__DEV__) return;
  try {
    // eslint-disable-next-line no-console
    console.log(`[AUTH_PHONE] ${tag}${data === undefined ? '' : ` ${JSON.stringify(data)}`}`);
  } catch {
    // eslint-disable-next-line no-console
    console.log(`[AUTH_PHONE] ${tag}`);
  }
}

function getDiagnostics(): PhoneAuthDiagnosticsNative | null {
  if (Platform.OS !== 'android') return null;
  return NativeModules.PhoneAuthDiagnostics as PhoneAuthDiagnosticsNative | undefined ?? null;
}

async function logSigningDiagnostics(): Promise<void> {
  const mod = getDiagnostics();
  if (!mod?.getSigningFingerprints) return;
  try {
    const { sha1, sha256 } = await mod.getSigningFingerprints();
    const registered = getRegisteredSha1FingerprintsForPackage();
    const sha1Norm = sha1.map(normalizeSha);
    const sha1Match = sha1Norm.some((s) => registered.includes(s));
    logAuth('AUTH_SIGNING_CERTS', {
      sha1Prefixes: sha1Norm.map((s) => s.slice(0, 8)),
      sha256Prefixes: sha256.map((s) => normalizeSha(s).slice(0, 8)),
      sha1RegisteredInGoogleServices: sha1Match,
      sha256Full: sha256,
    });
    if (!sha1Match) {
      logAuth('AUTH_SIGNING_MISMATCH', {
        hint: 'Add SHA-1 and SHA-256 in Firebase Console → com.gyw1.chat',
        sha1,
        sha256,
      });
    }
  } catch (e) {
    logAuth('AUTH_SIGNING_READ_FAIL', { message: String((e as Error)?.message ?? e) });
  }
}

function isOtpQuotaExceeded(error: unknown): boolean {
  const msg = String((error as { message?: string })?.message ?? '');
  return /error code:\s*39/i.test(msg);
}

function isMissingClientIdentifier(error: unknown): boolean {
  const e = error as { code?: string; message?: string; userInfo?: { code?: string } };
  const code = e?.code ?? e?.userInfo?.code ?? '';
  const msg = e?.message ?? '';
  return (
    code === 'auth/missing-client-identifier' ||
    code === 'missing-client-identifier' ||
    msg.includes('missing-client-identifier')
  );
}

const NATIVE_OTP_ATTEMPT_MS = 45_000;

function isOtpAttemptTimeout(error: unknown): boolean {
  return (error as { code?: string })?.code === 'auth/timeout';
}

async function withOtpAttemptTimeout<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            Object.assign(new Error(`Phone verification timed out (${label})`), {
              code: 'auth/timeout',
            }),
          );
        }, NATIVE_OTP_ATTEMPT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Clear JS session only — never wipe Firebase crypto prefs before OTP (breaks silent reCAPTCHA). */
async function resetNativePhoneAuthState(
  _authInstance: ReturnType<typeof getRnAuth>,
  options?: { clearCrypto?: boolean },
): Promise<void> {
  clearPhoneLoginSession();
  if (options?.clearCrypto && Platform.OS === 'android') {
    try {
      await clearAndroidPhoneAuthCrypto();
    } catch {
      /* manual recovery only */
    }
  }
}

function resetAuthSettings(authInstance: ReturnType<typeof getRnAuth>, isTestNumber: boolean): void {
  authInstance.settings.appVerificationDisabledForTesting = isTestNumber;
  authInstance.settings.forceRecaptchaFlowForTesting = false;
}

async function sendViaSignInWithPhoneNumber(
  authInstance: ReturnType<typeof getRnAuth>,
  phoneNumber: string,
): Promise<string> {
  authInstance.settings.forceRecaptchaFlowForTesting = false;
  logAuth('AUTH_SIGN_IN_WITH_PHONE_PATH', { forceRecaptcha: false });
  const { signInWithPhoneNumber } = require('@react-native-firebase/auth') as typeof import('@react-native-firebase/auth');
  const result = await signInWithPhoneNumber(authInstance, phoneNumber);
  const vid = result?.verificationId;
  if (!vid) {
    throw Object.assign(new Error('Phone verification returned no verificationId'), {
      code: 'auth/internal-error',
    });
  }
  return vid;
}

/** Native Android OTP with prep, signing diagnostics, and staged retry for real numbers. */
export async function sendPhoneOtpNative(phoneNumber: string): Promise<string> {
  await ensureAuthUiReady();

  const { appVerificationDisabled, isTestNumber } = configurePhoneAuthForNumber(phoneNumber);
  logAuth('AUTH_PHONE_SETTINGS', {
    appVerificationDisabledForTesting: appVerificationDisabled,
    isTestNumber,
    hint: isTestNumber
      ? 'Test/allowlist number — verification disabled'
      : 'Real number — Play Integrity (no checkbox reCAPTCHA)',
  });

  logAndroidAuthEnvironment('AUTH_PHONE_SEND');
  await logSigningDiagnostics();

  const prep = await prepareAndroidPhoneAuth();
  if (prep && !prep.deviceSecure) {
    warnIfNoScreenLock(false);
  }
  logAuth('AUTH_PREPARE_DONE', prep ?? { skipped: true });

  const authInstance = getRnAuth();
  if (!authInstance) {
    throw new Error('Native Firebase Auth is not initialized');
  }

  await resetNativePhoneAuthState(authInstance);

  const mod = getDiagnostics();
  if (mod?.getAuthActivitySnapshot) {
    try {
      const snap = await mod.getAuthActivitySnapshot();
      logAuth('AUTH_ACTIVITY_SNAPSHOT', snap);
    } catch {
      /* non-fatal */
    }
  }

  logAuth('AUTH_PROVIDER_START', { provider: 'native/@react-native-firebase/auth' });
  prodDebug('AUTH_OTP_NATIVE_START', { platform: Platform.OS });

  const attempts: Array<{ label: string; fn: () => Promise<string> }> = [
    { label: 'sign_in_play_integrity', fn: () => sendViaSignInWithPhoneNumber(authInstance, phoneNumber) },
  ];

  let lastError: unknown = null;

  for (let i = 0; i < attempts.length; i++) {
    const { label, fn } = attempts[i];
    resetAuthSettings(authInstance, isTestNumber);
    try {
      const vid = await withOtpAttemptTimeout(label, fn);
      setPhoneLoginSession({ mode: 'native', verificationId: vid, phone: phoneNumber });
      logAuth('AUTH_NATIVE_SUCCESS', { path: label });
      prodDebug('AUTH_OTP_NATIVE_OK', { path: label });
      return vid;
    } catch (error) {
      lastError = error;
      prodDebugError('AUTH_OTP_NATIVE_ATTEMPT_FAIL', error, { path: label });
      if (isOtpQuotaExceeded(error)) {
        throw error;
      }
      if (isOtpAttemptTimeout(error)) {
        logAuth('AUTH_NATIVE_ATTEMPT_TIMEOUT', { path: label });
        if (i < attempts.length - 1) {
          await resetNativePhoneAuthState(authInstance, { clearCrypto: true });
          await ensureAuthUiReady();
          await prepareAndroidPhoneAuth();
          continue;
        }
        throw error;
      }
      if (!isMissingClientIdentifier(error)) {
        throw error;
      }
      logAuth('AUTH_NATIVE_ATTEMPT_FAILED', {
        path: label,
        code: (error as { code?: string })?.code,
      });
      if (i < attempts.length - 1) {
        await ensureAuthUiReady();
        await prepareAndroidPhoneAuth();
      }
    }
  }

  try {
    resetAuthSettings(authInstance, isTestNumber);
  } catch {
    /* ignore */
  }

  if (isMissingClientIdentifier(lastError)) {
    throw Object.assign(
      new Error(
        'Firebase could not verify this app for a real phone number. ' +
          'Enable Play Integrity API in Google Cloud (gyw1-146d7), add SHA-256 in Firebase Console ' +
          '(including Play App Signing), or wait if you were rate-limited.'
      ),
      { code: 'auth/missing-client-identifier', cause: lastError },
    );
  }
  throw lastError;
}

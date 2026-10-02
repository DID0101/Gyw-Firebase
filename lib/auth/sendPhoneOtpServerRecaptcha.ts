/**
 * Server OTP with reCAPTCHA — invisible on native (silent) and web.
 */
import { Platform } from 'react-native';

import {
  requestInvisibleRecaptchaToken,
  requestVisibleRecaptchaToken,
} from '@/lib/auth/phoneAuthRecaptchaBridge';
import { requestWebInvisibleRecaptchaToken } from '@/lib/auth/requestWebRecaptchaToken';
import { sendPhoneOtpServer } from '@/lib/auth/sendPhoneOtpServer';
import { prodDebugError } from '@/lib/debug/prodDebug';

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

async function requestRecaptchaToken(mode: 'invisible' | 'visible'): Promise<string> {
  if (Platform.OS === 'web') {
    return requestWebInvisibleRecaptchaToken();
  }
  return mode === 'invisible'
    ? requestInvisibleRecaptchaToken()
    : requestVisibleRecaptchaToken();
}

async function sendWithRecaptcha(
  phoneNumber: string,
  mode: 'invisible' | 'visible',
): Promise<string> {
  logAuth('AUTH_RECAPTCHA_START', { platform: Platform.OS, mode });

  try {
    const recaptchaToken = await requestRecaptchaToken(mode);
    logAuth('AUTH_RECAPTCHA_TOKEN_OK', {
      tokenLength: recaptchaToken?.length ?? 0,
      mode,
    });
    return await sendPhoneOtpServer(phoneNumber, recaptchaToken);
  } catch (e) {
    logAuth('AUTH_RECAPTCHA_TOKEN_FAIL', {
      message: e instanceof Error ? e.message : String(e),
      code: (e as { code?: string })?.code,
      mode,
    });
    prodDebugError('AUTH_RECAPTCHA_FAIL', e, { platform: Platform.OS, mode });
    throw e;
  }
}

/** Silent server fallback — no visible checkbox. */
export async function sendPhoneOtpServerWithInvisibleRecaptcha(
  phoneNumber: string,
): Promise<string> {
  return sendWithRecaptcha(phoneNumber, 'invisible');
}

/** Visible checkbox — legacy / last resort only. */
export async function sendPhoneOtpServerWithRecaptcha(phoneNumber: string): Promise<string> {
  return sendWithRecaptcha(phoneNumber, 'visible');
}

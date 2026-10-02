import { Platform } from 'react-native';



import { functions, httpsCallable } from '@/lib/firebase';



import { setPhoneLoginSession } from './phoneLoginSession';
import { callNativeCallable } from './nativeCallableRest';
import { clearServerOtpSession, persistServerOtpSession } from './phoneOtpSessionStore';

type SendResponse = { sessionInfo: string; mode: 'server' };
type VerifyResponse = { customToken: string; uid: string; phoneNumber: string | null };

function phoneCallableWeb<TReq, TRes>(name: string) {
  return httpsCallable<TReq, TRes>(functions, name);
}

export async function sendPhoneOtpServer(phoneNumber: string, recaptchaToken?: string): Promise<string> {
  const payload: { phoneNumber: string; recaptchaToken?: string } = { phoneNumber };
  if (recaptchaToken) {
    payload.recaptchaToken = recaptchaToken;
  }

  const data =
    Platform.OS === 'web'
      ? (await phoneCallableWeb<typeof payload, SendResponse>('sendPhoneLoginOtp')(payload)).data
      : await callNativeCallable<typeof payload, SendResponse>('sendPhoneLoginOtp', payload);

  if (!data?.sessionInfo) {
    throw new Error('Server did not return a phone verification session');
  }

  setPhoneLoginSession({ mode: 'server', sessionInfo: data.sessionInfo, phone: phoneNumber });
  const verificationId = `server:${data.sessionInfo.slice(0, 16)}`;
  await persistServerOtpSession(data.sessionInfo, phoneNumber, verificationId);
  return verificationId;
}

export async function verifyPhoneOtpServer(
  sessionInfo: string,
  code: string,
  phoneNumber: string
): Promise<{ uid: string; phoneNumber: string | null; customToken: string }> {
  const payload = { sessionInfo, code, phoneNumber };
  return Platform.OS === 'web'
    ? (await phoneCallableWeb<typeof payload, VerifyResponse>('verifyPhoneLoginOtp')(payload)).data
    : await callNativeCallable<typeof payload, VerifyResponse>('verifyPhoneLoginOtp', payload);
}


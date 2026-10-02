/** Web invisible reCAPTCHA for server phone OTP (no checkbox). */
import { auth } from '@/lib/firebase';

let verifier: {
  clear: () => void;
  render: () => Promise<number>;
  verify: () => Promise<string>;
} | null = null;

function clearVerifier(): void {
  if (!verifier) return;
  try {
    verifier.clear();
  } catch {
    /* ignore */
  }
  verifier = null;
}

export async function requestWebInvisibleRecaptchaToken(): Promise<string> {
  const { RecaptchaVerifier } = await import('firebase/auth');
  clearVerifier();

  verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
    size: 'invisible',
    callback: () => {},
    'expired-callback': () => {},
  });
  await verifier.render();
  return verifier.verify();
}

/** @deprecated Use requestWebInvisibleRecaptchaToken */
export async function requestWebVisibleRecaptchaToken(): Promise<string> {
  return requestWebInvisibleRecaptchaToken();
}

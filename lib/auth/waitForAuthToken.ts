import { Platform } from 'react-native';

import { auth } from '@/lib/firebase';
import { getRnAuth, hasRnFirebase } from '@/lib/rnFirebase';

/** After phone sign-in, Firestore reads can fail until the ID token is attached. */
export async function waitForAuthToken(maxMs = 8000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      if (Platform.OS !== 'web' && hasRnFirebase) {
        const rnAuth = getRnAuth();
        const user = rnAuth?.currentUser;
        if (user) {
          await user.getIdToken(false);
          return true;
        }
      } else if (auth.currentUser) {
        await auth.currentUser.getIdToken();
        return true;
      }
    } catch {
      /* token not ready yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function isPermissionDeniedError(e: unknown): boolean {
  const code = String((e as { code?: string })?.code ?? '');
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return code.includes('permission-denied') || msg.includes('permission-denied');
}

export { isPermissionDeniedError };

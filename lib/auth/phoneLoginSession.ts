export type PhoneLoginSession =
  | { mode: 'native'; verificationId: string; phone: string }
  | { mode: 'server'; sessionInfo: string; phone: string }
  | { mode: 'dev'; phone: string; devPending: true };

let activeSession: PhoneLoginSession | null = null;

export function setPhoneLoginSession(session: PhoneLoginSession): void {
  activeSession = session;
}

export function getPhoneLoginSession(): PhoneLoginSession | null {
  return activeSession;
}

export function clearPhoneLoginSession(): void {
  activeSession = null;
}

export function peekPhoneLoginMode(): 'native' | 'server' | 'dev' | null {
  return activeSession?.mode ?? null;
}

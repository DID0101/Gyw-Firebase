/**
 * Strict authentication finite state machine — single source of truth for auth phase.
 * Only one `AuthPhase` is active at any time (no parallel booleans).
 */

export type AuthPhase =
  | 'APP_STARTING'
  | 'FIREBASE_READY'
  | 'CHECKING_SESSION'
  | 'UNAUTHENTICATED'
  | 'REQUESTING_OTP'
  | 'OTP_SENT'
  | 'VERIFYING_OTP'
  | 'AUTHENTICATED'
  | 'CHECKING_PROFILE'
  | 'CREATING_PROFILE'
  | 'PROFILE_READY'
  | 'AUTH_READY'
  | 'AUTH_ERROR'
  | 'OFFLINE';

/** Legal transitions: from → Set<to> */
const ALLOWED: Readonly<Record<AuthPhase, ReadonlySet<AuthPhase>>> = {
  APP_STARTING: new Set(['FIREBASE_READY', 'AUTH_ERROR', 'OFFLINE']),
  FIREBASE_READY: new Set(['CHECKING_SESSION', 'AUTH_ERROR', 'OFFLINE']),
  CHECKING_SESSION: new Set([
    'UNAUTHENTICATED',
    'AUTHENTICATED',
    'AUTH_ERROR',
    'OFFLINE',
  ]),
  UNAUTHENTICATED: new Set([
    'REQUESTING_OTP',
    'CHECKING_SESSION',
    'AUTH_READY',
    'AUTH_ERROR',
    'OFFLINE',
  ]),
  REQUESTING_OTP: new Set(['OTP_SENT', 'UNAUTHENTICATED', 'AUTH_ERROR', 'OFFLINE']),
  OTP_SENT: new Set([
    'VERIFYING_OTP',
    'REQUESTING_OTP',
    'UNAUTHENTICATED',
    'AUTH_ERROR',
    'OFFLINE',
  ]),
  VERIFYING_OTP: new Set([
    'AUTHENTICATED',
    'OTP_SENT',
    'UNAUTHENTICATED',
    'AUTH_ERROR',
    'OFFLINE',
  ]),
  AUTHENTICATED: new Set([
    'CHECKING_PROFILE',
    'AUTH_READY',
    'CREATING_PROFILE',
    'UNAUTHENTICATED',
    'AUTH_ERROR',
    'OFFLINE',
  ]),
  CHECKING_PROFILE: new Set([
    'PROFILE_READY',
    'CREATING_PROFILE',
    'UNAUTHENTICATED',
    'AUTH_ERROR',
    'OFFLINE',
  ]),
  CREATING_PROFILE: new Set([
    'PROFILE_READY',
    'AUTHENTICATED',
    'AUTH_ERROR',
    'OFFLINE',
  ]),
  PROFILE_READY: new Set(['AUTH_READY', 'UNAUTHENTICATED', 'AUTH_ERROR', 'OFFLINE']),
  AUTH_READY: new Set([
    'UNAUTHENTICATED',
    'REQUESTING_OTP',
    'CHECKING_SESSION',
    'AUTHENTICATED',
    'CHECKING_PROFILE',
    'CREATING_PROFILE',
    'OFFLINE',
    'AUTH_ERROR',
  ]),
  AUTH_ERROR: new Set([
    'UNAUTHENTICATED',
    'REQUESTING_OTP',
    'OTP_SENT',
    'CHECKING_SESSION',
    'AUTH_READY',
    'OFFLINE',
  ]),
  OFFLINE: new Set([
    'UNAUTHENTICATED',
    'REQUESTING_OTP',
    'OTP_SENT',
    'VERIFYING_OTP',
    'CHECKING_SESSION',
    'AUTH_READY',
    'AUTH_ERROR',
  ]),
};

export type AuthTransitionMeta = {
  reason: string;
  errorCode?: string;
  durationMs?: number;
};

export type AuthTransitionListener = (event: {
  from: AuthPhase;
  to: AuthPhase;
  reason: string;
  timestamp: number;
  meta?: AuthTransitionMeta;
}) => void;

export class AuthStateMachine {
  private phase: AuthPhase = 'APP_STARTING';
  private readonly listeners = new Set<AuthTransitionListener>();
  private lastTransitionAt = Date.now();

  getPhase(): AuthPhase {
    return this.phase;
  }

  subscribe(listener: AuthTransitionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Session/bootstrap loading — true until first session check completes.
   */
  isSessionLoading(): boolean {
    return (
      this.phase === 'APP_STARTING' ||
      this.phase === 'FIREBASE_READY' ||
      this.phase === 'CHECKING_SESSION'
    );
  }

  isOtpFlow(): boolean {
    return (
      this.phase === 'REQUESTING_OTP' ||
      this.phase === 'OTP_SENT' ||
      this.phase === 'VERIFYING_OTP'
    );
  }

  canTransition(to: AuthPhase): boolean {
    return ALLOWED[this.phase]?.has(to) ?? false;
  }

  transition(to: AuthPhase, reason: string, meta?: AuthTransitionMeta): AuthPhase {
    const from = this.phase;
    if (from === to) {
      return to;
    }
    if (!this.canTransition(to)) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn(
          `[AUTH_STATE] illegal transition blocked ${from} → ${to} (${reason})`
        );
      }
      return from;
    }
    this.phase = to;
    this.lastTransitionAt = Date.now();
    const event = {
      from,
      to,
      reason,
      timestamp: this.lastTransitionAt,
      meta,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* non-fatal */
      }
    }
    return to;
  }

  /** Force phase for recovery (strangler only — logs in dev). */
  forceTransition(to: AuthPhase, reason: string, meta?: AuthTransitionMeta): AuthPhase {
    const from = this.phase;
    if (from === to) return to;
    this.phase = to;
    this.lastTransitionAt = Date.now();
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(`[AUTH_STATE] forced ${from} → ${to} (${reason})`);
    }
    const event = { from, to, reason, timestamp: this.lastTransitionAt, meta };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* non-fatal */
      }
    }
    return to;
  }
}

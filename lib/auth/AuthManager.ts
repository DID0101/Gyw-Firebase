/**
 * Single owner of Firebase Phone Authentication (strangler migration).
 * Screens must use authCompat or AuthContext — not Firebase Auth directly.
 */
import { clearLastKnownAuthUid, persistLastKnownAuthUid } from '@/lib/authLastKnownUid';
import { prodDebug, prodDebugError } from '@/lib/debug/prodDebug';
import { logAuthState, setAuthRuntimeState } from '@/lib/debug/runtimeDiagnostics';
import { registerPushTokens, unregisterPushTokens } from '@/lib/fcmTokenService';
import { auth } from '@/lib/firebase';
import {
  confirmPhoneOTP,
  friendlyAuthError,
  getPhoneOtpSessionForPersistence,
  sendPhoneOTP,
  type SendPhoneOtpOptions,
} from '@/lib/phoneAuth';
import { getNetworkState } from '@/lib/reliability/NetworkManager';
import { logAuthReliability } from '@/lib/reliability/reliabilityLog';
import { retryOperation } from '@/lib/reliability/RetryManager';
import { setSentryUser } from '@/lib/reliability/SentryManager';
import { getRnAuth, hasRnFirebase } from '@/lib/rnFirebase';
import { setAnalyticsUserId, trackLogout } from '@/lib/services/analyticsService';
import {
  crashlyticsLog,
  setCrashlyticsUser,
} from '@/lib/services/crashlyticsService';
import { useCallSessionStore } from '@/store/callSessionStore';
import { useCallStore } from '@/store/callStore';
import { useChatStore } from '@/store/chatStore';
import { useStoryStore } from '@/store/storyStore';
import { persistence } from '@/store/persistence';
import { useUserProfileStore } from '@/store/userProfileStore';
import type { User } from 'firebase/auth';
import { Platform } from 'react-native';

import { AuthStateMachine, type AuthPhase } from './AuthState';
import { logAuthManager, logAuthStateTransition } from './authLogger';
import { AuthOperationLock, withAuthLock } from './authLocks';
import { mapNativeUserToWebUser } from './authUserMapper';
import { writeUserDocReliable } from './userProfileWrite';

export type AuthProviderKind = 'web' | 'native' | null;

export type AuthManagerSnapshot = {
  phase: AuthPhase;
  user: User | null;
  /** True while restoring session on cold start (AuthContext compatibility). */
  loading: boolean;
  sessionReady: boolean;
  initialized: boolean;
  provider: AuthProviderKind;
  lastError: string | null;
};

type SnapshotListener = (snapshot: AuthManagerSnapshot) => void;

function clearPersistedCachesForAccountSwitch(): void {
  useChatStore.getState().clearAll();
  useCallStore.getState().clearAll();
  useStoryStore.getState().clearAll();
  useUserProfileStore.getState().clearAll();
  void persistence.clearAll();
}

class AuthManager {
  private readonly fsm = new AuthStateMachine();
  private readonly initLock = new AuthOperationLock('initialize');
  private readonly otpRequestLock = new AuthOperationLock('otp_request');
  private readonly otpVerifyLock = new AuthOperationLock('otp_verify');
  private readonly profileLock = new AuthOperationLock('profile_create');

  private initialized = false;
  private sessionChecked = false;
  private user: User | null = null;
  private provider: AuthProviderKind = null;
  private lastError: string | null = null;
  private prevUid: string | null = null;
  private pendingPhone: string | null = null;

  private authUnsub: (() => void) | undefined;
  private tokenUnsub: (() => void) | undefined;
  private readonly snapshotListeners = new Set<SnapshotListener>();

  constructor() {
    this.fsm.subscribe((event) => {
      logAuthStateTransition({
        from: event.from,
        to: event.to,
        reason: event.reason,
        timestamp: event.timestamp,
        userId: this.user?.uid ?? null,
        phone: this.pendingPhone ?? this.user?.phoneNumber,
        networkOnline: getNetworkState().isOnline,
        durationMs: event.meta?.durationMs,
        errorCode: event.meta?.errorCode,
      });
      this.emitSnapshot();
    });
  }

  subscribe(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    listener(this.getSnapshot());
    return () => this.snapshotListeners.delete(listener);
  }

  getSnapshot(): AuthManagerSnapshot {
    const phase = this.fsm.getPhase();
    return {
      phase,
      user: this.user,
      loading: !this.sessionChecked && this.fsm.isSessionLoading(),
      sessionReady: this.sessionChecked && phase === 'AUTH_READY',
      initialized: this.initialized,
      provider: this.provider,
      lastError: this.lastError,
    };
  }

  getCurrentUser(): User | null {
    return this.user;
  }

  getPhase(): AuthPhase {
    return this.fsm.getPhase();
  }

  private emitSnapshot(): void {
    const snap = this.getSnapshot();
    for (const listener of this.snapshotListeners) {
      try {
        listener(snap);
      } catch {
        /* non-fatal */
      }
    }
  }

  private transition(to: AuthPhase, reason: string, meta?: { errorCode?: string; durationMs?: number }): void {
    this.fsm.transition(to, reason, meta);
  }

  private assertOnlineForOtp(): void {
    if (!getNetworkState().isOnline) {
      this.transition('OFFLINE', 'network_offline_before_otp');
      throw Object.assign(new Error('No internet connection'), { code: 'network/offline' });
    }
  }

  /** Idempotent cold-start initialization. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.initLock.tryAcquire()) return;

    const started = Date.now();
    logAuthManager('INIT', { platform: Platform.OS });
    this.transition('FIREBASE_READY', 'firebase_modules_ready');

    try {
      if (Platform.OS === 'android') {
        try {
          require('@/lib/rnFirebase');
        } catch {
          /* non-fatal */
        }
      }
      require('@/lib/firebase');

      this.transition('CHECKING_SESSION', 'restore_session_start');
      await this.restoreSession();

      this.initialized = true;
      logAuthManager('INIT_DONE', { durationMs: Date.now() - started, provider: this.provider });
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.transition('AUTH_ERROR', 'initialize_failed', { errorCode: 'init_failed' });
      prodDebugError('AUTH_MANAGER_INIT_FAILED', e);
      this.sessionChecked = true;
      this.transition('AUTH_READY', 'init_error_degraded');
      this.initialized = true;
    } finally {
      this.initLock.release();
    }
  }

  /** Attach the sole JS auth state listener. */
  async restoreSession(): Promise<void> {
    if (this.authUnsub) return;

    setAuthRuntimeState({ ready: false, uid: null, provider: null, tokenAvailable: null });
    logAuthState('INIT_START', { platform: Platform.OS, hasRnFirebase, owner: 'AuthManager' });

    if (Platform.OS === 'web' || !hasRnFirebase) {
      this.provider = 'web';
      const { onAuthStateChanged, onIdTokenChanged } = await import('firebase/auth');
      this.authUnsub = onAuthStateChanged(auth, (u) => {
        this.handleAuthStateChanged(mapNativeUserToWebUser(u) ?? u, 'web');
      });
      this.tokenUnsub = onIdTokenChanged(auth, (u) => {
        if (u?.uid) {
          logAuthReliability('TOKEN_REFRESH', { provider: 'web', uid: u.uid.slice(0, 8) });
          this.logTokenAvailability('web', u.uid, u.getIdToken.bind(u));
        }
      });
      return;
    }

    const rnAuth = getRnAuth();
    if (!rnAuth) {
      this.provider = 'native';
      this.sessionChecked = true;
      this.transition('UNAUTHENTICATED', 'rn_auth_unavailable');
      this.transition('AUTH_READY', 'session_no_native_auth');
      return;
    }

    this.provider = 'native';
    try {
      const { onAuthStateChanged: rnOnAuthStateChanged, onIdTokenChanged: rnOnIdTokenChanged } =
        require('@react-native-firebase/auth');
      this.authUnsub = rnOnAuthStateChanged(rnAuth, (u: unknown) => {
        this.handleAuthStateChanged(mapNativeUserToWebUser(u), 'native');
      });
      this.tokenUnsub = rnOnIdTokenChanged(rnAuth, (u: unknown) => {
        const mapped = mapNativeUserToWebUser(u);
        if (mapped?.uid) {
          logAuthReliability('TOKEN_REFRESH', { provider: 'native', uid: mapped.uid.slice(0, 8) });
          this.logTokenAvailability('native', mapped.uid, mapped.getIdToken?.bind(mapped));
        }
      });
    } catch (e) {
      prodDebugError('AUTH_STATE_ERROR', e, { provider: 'native' });
      this.sessionChecked = true;
      this.transition('AUTH_ERROR', 'native_auth_listener_failed');
      this.transition('AUTH_READY', 'session_native_listener_error');
    }
  }

  handleAuthStateChanged(nextUser: User | null, provider: AuthProviderKind): void {
    const uid = nextUser?.uid ?? null;
    const wasChecked = this.sessionChecked;
    this.user = nextUser;
    this.provider = provider;
    this.lastError = null;

    setAuthRuntimeState({
      ready: false,
      uid,
      provider: provider ?? null,
      tokenAvailable: uid ? 'checking' : false,
    });

    if (!wasChecked) {
      this.sessionChecked = true;
      if (uid) {
        this.transition('AUTHENTICATED', 'session_user_present');
      } else {
        this.transition('UNAUTHENTICATED', 'session_user_null');
      }
      // Phase 2: profile states deferred — jump to AUTH_READY for navigation compatibility.
      this.transition('AUTH_READY', 'session_restore_complete');
    } else if (uid) {
      if (this.fsm.getPhase() === 'VERIFYING_OTP' || this.fsm.getPhase() === 'OTP_SENT') {
        this.transition('AUTHENTICATED', 'otp_verify_auth_callback');
        this.transition('AUTH_READY', 'post_otp_auth_ready');
      } else if (!this.fsm.isOtpFlow()) {
        this.transition('AUTHENTICATED', 'auth_state_user_set');
        this.transition('AUTH_READY', 'auth_state_ready');
      }
    } else {
      this.transition('UNAUTHENTICATED', 'auth_state_signed_out');
      this.transition('AUTH_READY', 'signed_out_ready');
    }

    logAuthState(uid ? 'AUTH_USER_SET' : 'AUTH_USER_NULL', {
      provider,
      uid,
      phonePresent: !!nextUser?.phoneNumber,
    });
    prodDebug('AUTH_STATE_CHANGED', {
      provider,
      signedIn: !!uid,
      uidPrefix: uid ? uid.slice(0, 8) : null,
      owner: 'AuthManager',
    });

    setAuthRuntimeState({
      ready: true,
      uid,
      provider: provider ?? null,
      tokenAvailable: uid ? 'checking' : false,
    });
    logAuthState('AUTH_READY', { provider, uid, signedIn: !!uid, owner: 'AuthManager' });

    if (uid && nextUser?.getIdToken) {
      this.logTokenAvailability(provider ?? 'web', uid, nextUser.getIdToken.bind(nextUser));
    }

    if (uid) {
      const prev = this.prevUid;
      if (prev != null && prev !== uid) {
        clearPersistedCachesForAccountSwitch();
      }
      this.prevUid = uid;
      void persistLastKnownAuthUid(uid);
      void registerPushTokens(uid);
      setSentryUser(uid);
      setCrashlyticsUser(uid);
      void setAnalyticsUserId(uid);
    } else {
      this.prevUid = null;
      clearPersistedCachesForAccountSwitch();
      void clearLastKnownAuthUid();
      void unregisterPushTokens();
      setSentryUser(null);
      setCrashlyticsUser(null);
      void setAnalyticsUserId(null);
    }

    this.emitSnapshot();
  }

  private logTokenAvailability(
    provider: string,
    uid: string,
    getToken?: (forceRefresh?: boolean) => Promise<string>,
  ): void {
    if (!getToken) return;
    setAuthRuntimeState({ tokenAvailable: 'checking' });
    void retryOperation(() => getToken(false), {
      label: 'auth_get_id_token',
      timeoutMs: 20_000,
      maxAttempts: 3,
      waitForReconnect: true,
    })
      .then((token) => {
        setAuthRuntimeState({ tokenAvailable: !!token });
        logAuthState('AUTH_USER_SET', {
          provider,
          uid,
          tokenAvailable: !!token,
          tokenLength: token?.length ?? 0,
        });
      })
      .catch((error) => {
        setAuthRuntimeState({ tokenAvailable: false });
        logAuthReliability('TOKEN_REFRESH_FAIL', {
          provider,
          uid: uid.slice(0, 8),
          reason: error instanceof Error ? error.message : String(error),
        });
      });
  }

  async requestOTP(phoneNumber: string, options?: SendPhoneOtpOptions): Promise<string | null> {
    this.assertOnlineForOtp();
    this.pendingPhone = phoneNumber;

    const result = await withAuthLock(this.otpRequestLock, async () => {
      const started = Date.now();
      logAuthManager('OTP_REQUEST', {
        phone: phoneNumber.slice(0, 3) + '***',
        method: options?.method ?? 'stored',
      });
      this.transition('REQUESTING_OTP', 'user_requested_otp');

      try {
        const verificationId = await Promise.race([
          sendPhoneOTP(phoneNumber, options),
          new Promise<string>((_, reject) => {
            setTimeout(
              () =>
                reject(
                  Object.assign(new Error('OTP request timed out'), { code: 'auth/timeout' }),
                ),
              95_000,
            );
          }),
        ]);
        this.transition('OTP_SENT', 'otp_sent_success', { durationMs: Date.now() - started });
        logAuthManager('OTP_SENT', { durationMs: Date.now() - started });
        return verificationId;
      } catch (e) {
        const code = (e as { code?: string })?.code ?? 'unknown';
        this.lastError = friendlyAuthError(e);
        this.transition('AUTH_ERROR', 'otp_send_failed', { errorCode: code });
        if (getNetworkState().isOnline) {
          this.transition('UNAUTHENTICATED', 'otp_send_failed_recovery');
          this.transition('AUTH_READY', 'post_otp_error_ready');
        }
        throw e;
      }
    });

    return result ?? null;
  }

  async verifyOTP(
    verificationId: string,
    code: string,
  ): Promise<{ uid: string; phoneNumber: string | null } | null> {
    const result = await withAuthLock(this.otpVerifyLock, async () => {
      const started = Date.now();
      logAuthManager('OTP_VERIFY', {});
      this.transition('VERIFYING_OTP', 'user_submitted_code');

      try {
        // TODO: AUTH_REFACTOR_REMOVE — inline confirmPhoneOTP
        const out = await confirmPhoneOTP(verificationId, code);
        logAuthManager('OTP_VERIFY_OK', { durationMs: Date.now() - started, uid: out.uid.slice(0, 8) });
        return out;
      } catch (e) {
        const code_ = (e as { code?: string })?.code ?? 'unknown';
        this.lastError = friendlyAuthError(e);
        this.transition('AUTH_ERROR', 'otp_verify_failed', { errorCode: code_ });
        if (this.fsm.getPhase() !== 'AUTHENTICATED') {
          this.transition('OTP_SENT', 'otp_verify_failed_stay_on_otp');
        }
        throw e;
      }
    });

    return result ?? null;
  }

  /** OTP session metadata for pending-login persistence (compat layer). */
  getOtpPersistenceMeta(): ReturnType<typeof getPhoneOtpSessionForPersistence> {
    return getPhoneOtpSessionForPersistence();
  }

  /**
   * Idempotent profile creation — Phase 2 interface only.
   * Screens still call writeUserDocReliable directly until Phase 6 migration.
   */
  async createUserProfileIfNeeded(
    uid: string,
    data: Record<string, unknown>,
  ): Promise<boolean | null> {
    return withAuthLock(this.profileLock, async () => {
      const started = Date.now();
      logAuthManager('PROFILE_CREATE', { uid: uid.slice(0, 8) });
      this.transition('CREATING_PROFILE', 'create_user_profile_start');

      try {
        await writeUserDocReliable(uid, data);
        this.transition('PROFILE_READY', 'profile_create_success', { durationMs: Date.now() - started });
        if (this.user?.uid === uid) {
          this.transition('AUTH_READY', 'profile_create_auth_ready');
        }
        logAuthManager('PROFILE_CREATE_OK', { durationMs: Date.now() - started });
        return true;
      } catch (e) {
        const code = (e as { code?: string })?.code ?? 'profile_write_failed';
        this.lastError = e instanceof Error ? e.message : String(e);
        this.transition('AUTH_ERROR', 'profile_create_failed', { errorCode: code });
        throw e;
      }
    });
  }

  async signOut(): Promise<void> {
    prodDebug('AUTH_SIGN_OUT_START', { provider: this.provider, owner: 'AuthManager' });
    crashlyticsLog('user_logout');
    void trackLogout();
    setCrashlyticsUser(null);
    void setAnalyticsUserId(null);

    await useCallSessionStore.getState().reset().catch((e) => {
      prodDebugError('AUTH_SIGN_OUT_ERROR', e, { phase: 'call_session_reset' });
    });

    if (Platform.OS === 'web' || !hasRnFirebase) {
      const { signOut: firebaseSignOut } = await import('firebase/auth');
      await firebaseSignOut(auth);
      return;
    }

    const rnAuth = getRnAuth();
    if (!rnAuth) return;
    const { signOut: rnSignOut } = require('@react-native-firebase/auth');
    await rnSignOut(rnAuth);
  }

  /** Tear down listeners (tests / hot reload). */
  dispose(): void {
    this.authUnsub?.();
    this.tokenUnsub?.();
    this.authUnsub = undefined;
    this.tokenUnsub = undefined;
  }
}

export const authManager = new AuthManager();

/**
 * Single source of truth for "who is signed in" on the current platform.
 * Migration target: replace all `auth.currentUser` / scattered getRnAuth() reads.
 *
 * AuthManager owns the live user; this module exposes read-only helpers.
 */
import { Platform } from 'react-native';
import type { User } from 'firebase/auth';

import { authManager } from '@/lib/auth/AuthManager';

/** Prefer AuthManager snapshot (RN on native, web on web). */
export function getAuthUser(): User | null {
  return authManager.getCurrentUser();
}

export function getSignedInUid(): string | null {
  return authManager.getCurrentUser()?.uid ?? null;
}

export function isAuthSessionReady(): boolean {
  return authManager.getSnapshot().sessionReady;
}

/**
 * Migration helper — documents which SDK path is authoritative.
 * Native: @react-native-firebase/auth via AuthManager.
 * Web: firebase/auth via AuthManager.
 */
export function getAuthIdentitySource(): 'auth_manager_web' | 'auth_manager_native' | 'uninitialized' {
  const snap = authManager.getSnapshot();
  if (!snap.initialized) return 'uninitialized';
  return Platform.OS === 'web' || snap.provider === 'web' ? 'auth_manager_web' : 'auth_manager_native';
}

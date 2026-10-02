/**
 * Thin React layer over AuthManager — no direct Firebase Auth listeners here.
 * Target: Firebase Auth → AuthManager → AuthContext → Navigation → Screens
 */
import { authManager, type AuthManagerSnapshot } from '@/lib/auth/AuthManager';
import type { AuthPhase } from '@/lib/auth/AuthState';
import type { User } from 'firebase/auth';
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  /** FSM phase — navigation controller will consume this in Phase 8+. */
  authPhase: AuthPhase;
  sessionReady: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function snapshotToContext(snap: AuthManagerSnapshot): Omit<AuthContextType, 'signOut'> {
  return {
    user: snap.user,
    loading: snap.loading,
    authPhase: snap.phase,
    sessionReady: snap.sessionReady,
  };
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState(() => snapshotToContext(authManager.getSnapshot()));

  useEffect(() => {
    void authManager.initialize();
    return authManager.subscribe((snap) => {
      setState(snapshotToContext(snap));
    });
  }, []);

  const signOut = useCallback(async () => {
    await authManager.signOut();
  }, []);

  const contextValue = useMemo(
    () => ({ ...state, signOut }),
    [state, signOut],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

/* TODO: AUTH_REFACTOR_REMOVE — legacy direct Firebase listeners lived here (Phase 1).
 * Side effects (push tokens, Sentry, cache clear, token refresh) moved to AuthManager.handleAuthStateChanged.
 */

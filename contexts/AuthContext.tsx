import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { createContext, useContext, useEffect, useState, useMemo, useCallback, ReactNode } from 'react';
import { Platform } from 'react-native';
import { auth } from '@/lib/firebase';
import { clearPushToken } from '@/lib/pushTokenService';
import { getRnAuth, hasRnFirebase } from '@/lib/rnFirebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Convert native user to web-compatible shape (avoid refreshToken - unsupported on native) */
function toWebUser(nativeUser: any): User | null {
  if (!nativeUser) return null;
  return {
    uid: nativeUser.uid,
    email: nativeUser.email ?? null,
    displayName: nativeUser.displayName ?? null,
    phoneNumber: nativeUser.phoneNumber ?? null,
    photoURL: nativeUser.photoURL ?? null,
    emailVerified: nativeUser.emailVerified ?? false,
    isAnonymous: nativeUser.isAnonymous ?? false,
    metadata: nativeUser.metadata ?? {},
    providerData: nativeUser.providerData ?? [],
    refreshToken: '', // Native SDK doesn't support refreshToken - use empty string
    tenantId: nativeUser.tenantId ?? null,
    delete: nativeUser.delete?.bind(nativeUser),
    getIdToken: nativeUser.getIdToken?.bind(nativeUser),
    getIdTokenResult: nativeUser.getIdTokenResult?.bind(nativeUser),
    reload: nativeUser.reload?.bind(nativeUser),
    toJSON: nativeUser.toJSON?.bind(nativeUser),
  } as User;
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (Platform.OS === 'web' || !hasRnFirebase) {
      const unsubscribe = onAuthStateChanged(auth, (u) => {
        setUser(u);
        setLoading(false);
      });
      return () => unsubscribe();
    }

    // Native: use modular @react-native-firebase/auth (same app as Firestore/Functions)
    const rnAuth = getRnAuth();
    if (!rnAuth) {
      setLoading(false);
      return;
    }
    const { onAuthStateChanged: rnOnAuthStateChanged } = require('@react-native-firebase/auth');
    const unsubscribe = rnOnAuthStateChanged(rnAuth, (u: any) => {
      setUser(toWebUser(u));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    const uid = user?.uid;
    if (uid) await clearPushToken(uid).catch(() => {});
    if (Platform.OS === 'web' || !hasRnFirebase) {
      await firebaseSignOut(auth);
      return;
    }
    const rnAuth = getRnAuth();
    if (!rnAuth) return;
    const { signOut: rnSignOut } = require('@react-native-firebase/auth');
    await rnSignOut(rnAuth);
  }, [user?.uid]);

  const contextValue = useMemo(
    () => ({ user, loading, signOut }),
    [user, loading, signOut]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

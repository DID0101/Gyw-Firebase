import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef, ReactNode } from 'react';
import { Platform } from 'react-native';
import { clearLastKnownAuthUid, persistLastKnownAuthUid } from '@/lib/authLastKnownUid';
import { auth } from '@/lib/firebase';
import { getRnAuth, hasRnFirebase } from '@/lib/rnFirebase';
import { registerPushTokens, unregisterPushTokens } from '@/lib/fcmTokenService';
import { useCallSessionStore } from '@/store/callSessionStore';
import { useChatStore } from '@/store/chatStore';
import { useCallStore } from '@/store/callStore';
import { useStoryStore } from '@/store/storyStore';
import { persistence } from '@/store/persistence';

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

function clearPersistedCachesForAccountSwitch(): void {
  useChatStore.getState().clearAll();
  useCallStore.getState().clearAll();
  useStoryStore.getState().clearAll();
  void persistence.clearAll();
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  /** Tracks last signed-in uid so we can drop global (non–user-scoped) MMKV chat/call data when the account changes. */
  const prevAuthUidRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web' || !hasRnFirebase) {
      const unsubscribe = onAuthStateChanged(auth, (u) => {
        setUser(u);
        setLoading(false);
        if (u?.uid) {
          const prev = prevAuthUidRef.current;
          if (prev != null && prev !== u.uid) {
            clearPersistedCachesForAccountSwitch();
          }
          prevAuthUidRef.current = u.uid;
          void persistLastKnownAuthUid(u.uid);
          void registerPushTokens(u.uid);
        } else {
          prevAuthUidRef.current = null;
          clearPersistedCachesForAccountSwitch();
          void clearLastKnownAuthUid();
          void unregisterPushTokens();
        }
      });
      return () => unsubscribe();
    }

    // Native: use modular @react-native-firebase/auth (same app as Firestore/Functions)
    const rnAuth = getRnAuth();
    if (!rnAuth) {
      setLoading(false);
      return;
    }
    try {
      const { onAuthStateChanged: rnOnAuthStateChanged } = require('@react-native-firebase/auth');
      const unsubscribe = rnOnAuthStateChanged(rnAuth, (u: any) => {
        setUser(toWebUser(u));
        setLoading(false);
        if (u?.uid) {
          const prev = prevAuthUidRef.current;
          if (prev != null && prev !== u.uid) {
            clearPersistedCachesForAccountSwitch();
          }
          prevAuthUidRef.current = u.uid;
          void persistLastKnownAuthUid(u.uid);
          void registerPushTokens(u.uid);
        } else {
          prevAuthUidRef.current = null;
          clearPersistedCachesForAccountSwitch();
          void clearLastKnownAuthUid();
          void unregisterPushTokens();
        }
      });
      return () => unsubscribe();
    } catch (e) {
      console.warn('[AuthContext] Failed to load native auth module:', e);
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await useCallSessionStore.getState().reset().catch((e) => {
      console.warn('[AuthContext] signOut: call session reset failed:', e);
    });
    if (Platform.OS === 'web' || !hasRnFirebase) {
      await firebaseSignOut(auth);
      return;
    }
    const rnAuth = getRnAuth();
    if (!rnAuth) return;
    const { signOut: rnSignOut } = require('@react-native-firebase/auth');
    await rnSignOut(rnAuth);
  }, []);

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

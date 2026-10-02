import type { User } from 'firebase/auth';

/** Map native Firebase user → web-compatible User shape for AuthContext consumers. */
export function mapNativeUserToWebUser(nativeUser: unknown): User | null {
  if (!nativeUser || typeof nativeUser !== 'object') return null;
  const u = nativeUser as Record<string, unknown>;
  const uid = u.uid != null ? String(u.uid) : '';
  if (!uid) return null;
  return {
    uid,
    email: (u.email as string | null) ?? null,
    displayName: (u.displayName as string | null) ?? null,
    phoneNumber: (u.phoneNumber as string | null) ?? null,
    photoURL: (u.photoURL as string | null) ?? null,
    emailVerified: Boolean(u.emailVerified),
    isAnonymous: Boolean(u.isAnonymous),
    metadata: (u.metadata as User['metadata']) ?? {},
    providerData: (u.providerData as User['providerData']) ?? [],
    refreshToken: '',
    tenantId: (u.tenantId as string | null) ?? null,
    delete: typeof u.delete === 'function' ? (u.delete as User['delete']).bind(nativeUser) : undefined,
    getIdToken:
      typeof u.getIdToken === 'function'
        ? (u.getIdToken as User['getIdToken']).bind(nativeUser)
        : undefined,
    getIdTokenResult:
      typeof u.getIdTokenResult === 'function'
        ? (u.getIdTokenResult as User['getIdTokenResult']).bind(nativeUser)
        : undefined,
    reload: typeof u.reload === 'function' ? (u.reload as User['reload']).bind(nativeUser) : undefined,
    toJSON: typeof u.toJSON === 'function' ? (u.toJSON as User['toJSON']).bind(nativeUser) : undefined,
  } as User;
}

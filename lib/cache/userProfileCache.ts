import type { User } from '@/lib/types/chat';

const store = new Map<string, { user: User; storedAt: number }>();
const TTL_MS = 5 * 60 * 1000;

export function getCachedUserProfile(uid: string): User | null {
  const row = store.get(uid);
  if (!row) return null;
  if (Date.now() - row.storedAt > TTL_MS) {
    store.delete(uid);
    return null;
  }
  return row.user;
}

export function setCachedUserProfile(uid: string, user: User): void {
  store.set(uid, { user, storedAt: Date.now() });
}

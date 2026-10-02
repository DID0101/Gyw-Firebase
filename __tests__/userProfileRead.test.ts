import {
  isCompleteUserProfile,
  type UserProfileSnapshot,
} from '@/lib/auth/userProfileRead';

describe('isCompleteUserProfile', () => {
  it('requires firstName and username', () => {
    expect(isCompleteUserProfile({ firstName: 'Ada', username: 'ada1' })).toBe(true);
    expect(isCompleteUserProfile({ firstName: 'Ada' })).toBe(false);
    expect(isCompleteUserProfile({ username: 'ada1' })).toBe(false);
    expect(isCompleteUserProfile(null)).toBe(false);
  });

  it('ignores whitespace-only fields', () => {
    const profile: UserProfileSnapshot = { firstName: '  ', username: 'ada1' };
    expect(isCompleteUserProfile(profile)).toBe(false);
  });
});

describe('RN Firestore snapshot shape', () => {
  function snapDocExists(snap: { exists?: boolean | (() => boolean) }): boolean {
    return typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
  }

  function snapDocData<T>(snap: { data?: (() => T) | T }): T | undefined {
    if (typeof snap.data === 'function') return (snap.data as () => T)();
    return snap.data as T | undefined;
  }

  it('reads exists() method snapshots', () => {
    const snap = {
      exists: () => true,
      data: () => ({ firstName: 'Ada', username: 'ada1' }),
    };
    expect(snapDocExists(snap)).toBe(true);
    expect(isCompleteUserProfile(snapDocData(snap) as UserProfileSnapshot)).toBe(true);
  });

  it('reads exists boolean property snapshots', () => {
    const snap = {
      exists: true,
      data: { firstName: 'Ada', username: 'ada1' },
    };
    expect(snapDocExists(snap)).toBe(true);
    expect(isCompleteUserProfile(snapDocData(snap) as UserProfileSnapshot)).toBe(true);
  });

  it('treats missing docs as non-existent', () => {
    const snap = { exists: () => false, data: () => undefined };
    expect(snapDocExists(snap)).toBe(false);
  });
});

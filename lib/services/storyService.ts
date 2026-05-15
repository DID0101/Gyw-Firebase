import { Platform } from 'react-native';
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  deleteDoc,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import {
  addStoryNative,
  getStoryNative,
  getStoryViewsPageNative,
  getUserStoriesNative,
  hasNativeFirestore,
  storyViewDocExistsNative,
  subscribeStoryLikeStateNative,
  subscribeStoryLikesSheetNative,
  subscribeStoryViewsSheetNative,
  toggleLikeStoryNative,
  viewStoryNative,
} from '@/lib/firestoreNative';
import type { StoryLikeRow, StoryViewRow } from '@/lib/firestoreNative';

export type { StoryLikeRow, StoryViewRow } from '@/lib/firestoreNative';

/** True if legacy `story.viewers` marks this user as having watched. */
export function legacyStorySeenByUser(story: Pick<Story, 'viewers'>, viewerUid: string): boolean {
  const v = story.viewers;
  if (!Array.isArray(v) || !viewerUid) return false;
  return v.some((entry: any) =>
    typeof entry === 'object' && entry !== null ? entry.userId === viewerUid : entry === viewerUid
  );
}

/**
 * Batch-check `views/{viewerUid}` for many stories (chunked). Returns story ids that exist.
 * Used to sync ring state with subcollection without storing viewer arrays on parent docs.
 */
export async function batchCheckStoryViewsForViewer(
  storyIds: string[],
  viewerUid: string
): Promise<string[]> {
  if (!viewerUid || storyIds.length === 0) return [];
  const unique = Array.from(new Set(storyIds.filter(Boolean)));
  const found: string[] = [];
  const CHUNK = 14;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const results = await Promise.all(
      slice.map(async (id) => {
        try {
          if (Platform.OS !== 'web' && hasNativeFirestore) {
            const ok = await storyViewDocExistsNative(id, viewerUid);
            return ok ? id : null;
          }
          const snap = await getDoc(doc(db, 'stories', id, 'views', viewerUid));
          return snap.exists() ? id : null;
        } catch {
          return null;
        }
      })
    );
    for (const r of results) {
      if (r) found.push(r);
    }
  }
  return found;
}

export interface Story {
  id: string;
  userId: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  thumbnailUrl?: string; // For video stories
  caption?: string;
  createdAt: string;
  expiresAt: string; // createdAt + 24h
  /** @deprecated Legacy array on story doc; prefer views subcollection. */
  viewers?: Array<{ userId: string; viewedAt: string }>;
  /** @deprecated Legacy array of uids; prefer likes subcollection. */
  likes?: string[];
}

// Create a new story
export const createStory = async (
  userId: string,
  mediaUri: string,
  mediaType: 'image' | 'video',
  caption?: string
): Promise<string> => {
  try {
    const fileExtension = mediaType === 'video' ? 'mp4' : 'jpg';
    const timestamp = Date.now();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const storagePath = `stories/${userId}/${timestamp}.${fileExtension}`;

    let mediaUrl: string;
    if (Platform.OS !== 'web') {
      const { getRnStorage } = require('@/lib/rnFirebase');
      const { ref, putFile, getDownloadURL } = require('@react-native-firebase/storage');
      const rnStorage = getRnStorage();
      const storageRef = ref(rnStorage, storagePath);
      await putFile(storageRef, mediaUri);
      mediaUrl = await getDownloadURL(storageRef);
    } else {
      const storageRef = ref(storage, storagePath);
      const response = await fetch(mediaUri);
      if (!response.ok) throw new Error(`Failed to load file: ${response.status}`);
      let blob: Blob;
      try {
        blob = await response.blob();
      } catch {
        const response2 = await fetch(mediaUri, { method: 'GET', headers: { 'Content-Type': 'application/octet-stream' } });
        if (!response2.ok && response2.status !== 0) throw new Error(`Failed to load file: ${response2.status}`);
        try {
          blob = await response2.blob();
        } catch {
          blob = new Blob([await response2.arrayBuffer()]);
        }
      }
      await uploadBytes(storageRef, blob);
      mediaUrl = await getDownloadURL(storageRef);
    }

    const storyData: Omit<Story, 'id'> = {
      userId,
      mediaUrl,
      mediaType,
      ...(caption && { caption }),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    if (Platform.OS !== 'web' && hasNativeFirestore) {
      return addStoryNative(storyData);
    }

    const storiesRef = collection(db, 'stories');
    const docRef = await addDoc(storiesRef, {
      ...storyData,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt),
    });
    return docRef.id;
  } catch (error) {
    if (__DEV__) console.error('Error creating story:', error);
    throw error;
  }
};

// Get all active stories (not expired)
export const getStories = async (): Promise<Story[]> => {
  try {
    const now = Timestamp.now();
    const storiesRef = collection(db, 'stories');
    // Remove orderBy to avoid index requirement - we'll sort in memory
    const q = query(
      storiesRef,
      where('expiresAt', '>', now)
    );
    
    const snapshot = await getDocs(q);
    const stories: Story[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      stories.push({
        id: doc.id,
        userId: data.userId,
        mediaUrl: data.mediaUrl,
        mediaType: data.mediaType,
        thumbnailUrl: data.thumbnailUrl,
        caption: data.caption,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString(),
        expiresAt: data.expiresAt?.toDate?.()?.toISOString() || data.expiresAt || new Date().toISOString(),
        viewers: data.viewers || [],
        likes: data.likes || [],
      });
    });
    
    // Sort by createdAt (newest first) in memory
    stories.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    
    return stories;
  } catch (error) {
    if (__DEV__) console.error('Error getting stories:', error);
    throw error;
  }
};

// Get stories for a specific user
export const getUserStories = async (userId: string): Promise<Story[]> => {
  try {
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      return getUserStoriesNative(userId) as Promise<Story[]>;
    }
    const now = new Date();
    const storiesRef = collection(db, 'stories');
    const q = query(storiesRef, where('userId', '==', userId));
    const snapshot = await getDocs(q);
    const stories: Story[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const expiresAt = data.expiresAt?.toDate?.() || new Date(data.expiresAt);
      if (expiresAt > now) {
        stories.push({
          id: doc.id,
          userId: data.userId,
          mediaUrl: data.mediaUrl,
          mediaType: data.mediaType,
          thumbnailUrl: data.thumbnailUrl,
          caption: data.caption,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString(),
          expiresAt: expiresAt.toISOString(),
          viewers: data.viewers || [],
          likes: data.likes || [],
        });
      }
    });
    stories.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return stories;
  } catch (error) {
    if (__DEV__) console.error('Error getting user stories:', error);
    throw error;
  }
};

// Get a single story by ID
export const getStory = async (storyId: string): Promise<Story | null> => {
  try {
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      return getStoryNative(storyId) as Promise<Story | null>;
    }
    const storyRef = doc(db, 'stories', storyId);
    const storyDoc = await getDoc(storyRef);
    if (!storyDoc.exists()) return null;
    const data = storyDoc.data();
    return {
      id: storyDoc.id,
      userId: data.userId,
      mediaUrl: data.mediaUrl,
      mediaType: data.mediaType,
      thumbnailUrl: data.thumbnailUrl,
      caption: data.caption,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString(),
      expiresAt: data.expiresAt?.toDate?.()?.toISOString() || data.expiresAt || new Date().toISOString(),
      viewers: data.viewers || [],
      likes: data.likes || [],
    };
  } catch (error) {
    if (__DEV__) console.error('Error getting story:', error);
    throw error;
  }
};

/** Idempotent view write to stories/{storyId}/views/{viewerUid}. */
export const viewStory = async (storyId: string, userId: string): Promise<void> => {
  try {
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      await viewStoryNative(storyId, userId);
      return;
    }
    const storyRef = doc(db, 'stories', storyId);
    const storyDoc = await getDoc(storyRef);
    if (!storyDoc.exists()) return;
    const viewRef = doc(db, 'stories', storyId, 'views', userId);
    const existing = await getDoc(viewRef);
    if (existing.exists()) return;

    let username = '';
    let avatarUrl: string | undefined;
    try {
      const udoc = await getDoc(doc(db, 'users', userId));
      if (udoc.exists()) {
        const u = udoc.data();
        const name = `${u?.firstName || ''} ${u?.lastName || ''}`.trim();
        username = (u?.username || name || 'User').trim();
        const av = u?.avatar || u?.photoURL;
        if (av) avatarUrl = String(av);
      }
    } catch {
      /* ignore */
    }

    await setDoc(viewRef, {
      viewerId: userId,
      viewedAt: new Date().toISOString(),
      username: username || 'User',
      ...(avatarUrl ? { avatarUrl } : {}),
    });
  } catch (error) {
    if (__DEV__) console.error('Error viewing story:', error);
    throw error;
  }
};

/** Like / unlike via stories/{storyId}/likes/{userId}. */
export const toggleLikeStory = async (storyId: string, userId: string): Promise<boolean> => {
  try {
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      return toggleLikeStoryNative(storyId, userId);
    }
    const storyRef = doc(db, 'stories', storyId);
    const storyDoc = await getDoc(storyRef);
    if (!storyDoc.exists()) throw new Error('Story not found');
    const likeRef = doc(db, 'stories', storyId, 'likes', userId);
    const likeSnap = await getDoc(likeRef);
    if (likeSnap.exists()) {
      await deleteDoc(likeRef);
      return false;
    }

    let username = '';
    let avatarUrl: string | undefined;
    try {
      const udoc = await getDoc(doc(db, 'users', userId));
      if (udoc.exists()) {
        const u = udoc.data() as Record<string, unknown>;
        const name = `${u?.firstName || ''} ${u?.lastName || ''}`.trim();
        username = String((u?.username as string) || name || 'User').trim();
        const av = u?.avatar ?? u?.photoURL;
        if (av) avatarUrl = String(av);
      }
    } catch {
      /* ignore */
    }

    await setDoc(likeRef, {
      userId,
      createdAt: serverTimestamp(),
      username: username || 'User',
      ...(avatarUrl ? { avatarUrl } : {}),
    });
    return true;
  } catch (error) {
    if (__DEV__) console.error('Error toggling like:', error);
    throw error;
  }
};

// Delete a story
export const deleteStory = async (storyId: string, userId: string): Promise<void> => {
  try {
    const storyRef = doc(db, 'stories', storyId);
    const storyDoc = await getDoc(storyRef);
    
    if (!storyDoc.exists()) {
      throw new Error('Story not found');
    }
    
    const data = storyDoc.data();
    if (data.userId !== userId) {
      throw new Error('Unauthorized: Only the story owner can delete it');
    }
    
    // Delete media from storage (optional - can be done via Firebase Storage rules)
    // For now, we'll just delete the document
    
    await deleteDoc(storyRef);
  } catch (error) {
    if (__DEV__) console.error('Error deleting story:', error);
    throw error;
  }
};

/** Paginated viewer rows (newest first). */
export const getStoryViewersPage = async (
  storyId: string,
  pageSize: number = 50
): Promise<StoryViewRow[]> => {
  try {
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      return getStoryViewsPageNative(storyId, pageSize);
    }
    const viewsRef = collection(db, 'stories', storyId, 'views');
    const q = query(viewsRef, orderBy('viewedAt', 'desc'), limit(pageSize));
    const snap = await getDocs(q);
    const rows: StoryViewRow[] = [];
    snap.forEach((d) => {
      const v = d.data();
      const ts = v?.viewedAt;
      let viewedAt = '';
      if (typeof ts === 'string') viewedAt = ts;
      else if (ts && typeof (ts as any).toDate === 'function') viewedAt = (ts as any).toDate().toISOString();
      rows.push({
        viewerId: d.id,
        viewedAt,
        username: v?.username || '',
        avatarUrl: v?.avatarUrl,
      });
    });
    return rows;
  } catch (error) {
    if (__DEV__) console.error('Error getting story viewers:', error);
    throw error;
  }
};

export type { StoryViewRow };

export function subscribeStoryLikeState(
  storyId: string,
  viewerUid: string,
  onChange: (s: { likeCount: number; liked: boolean; capped: boolean }) => void,
  onError?: (e: Error) => void
): () => void {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    return subscribeStoryLikeStateNative(storyId, viewerUid, onChange, onError);
  }
  const CAP = 400;
  let latest = { likeCount: 0, liked: false, capped: false };
  const emit = () => onChange({ ...latest });
  const likesCol = collection(db, 'stories', storyId, 'likes');
  const q = query(likesCol, limit(CAP));
  const u1 = onSnapshot(
    q,
    (snap) => {
      latest.likeCount = snap.size;
      latest.capped = snap.size >= CAP;
      emit();
    },
    (e) => onError?.(e as Error)
  );
  const selfRef = doc(db, 'stories', storyId, 'likes', viewerUid);
  const u2 = onSnapshot(
    selfRef,
    (snap) => {
      latest.liked = snap.exists();
      emit();
    },
    (e) => onError?.(e as Error)
  );
  return () => {
    u1();
    u2();
  };
}

export function subscribeStoryViewsSheet(
  storyId: string,
  onRows: (rows: StoryViewRow[]) => void,
  onError?: (e: Error) => void,
  pageSize: number = 50
): () => void {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    return subscribeStoryViewsSheetNative(storyId, onRows, onError, pageSize);
  }
  const viewsRef = collection(db, 'stories', storyId, 'views');
  const q = query(viewsRef, orderBy('viewedAt', 'desc'), limit(pageSize));
  return onSnapshot(
    q,
    (snap) => {
      const rows: StoryViewRow[] = [];
      snap.forEach((d) => {
        const v = d.data();
        const ts = v?.viewedAt;
        let viewedAt = '';
        if (typeof ts === 'string') viewedAt = ts;
        else if (ts && typeof (ts as any).toDate === 'function') viewedAt = (ts as any).toDate().toISOString();
        rows.push({
          viewerId: d.id,
          viewedAt,
          username: v?.username || '',
          avatarUrl: v?.avatarUrl,
        });
      });
      onRows(rows);
    },
    (e) => onError?.(e as Error)
  );
}

export function subscribeStoryLikesSheet(
  storyId: string,
  onRows: (rows: StoryLikeRow[]) => void,
  onError?: (e: Error) => void,
  pageSize: number = 50
): () => void {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    return subscribeStoryLikesSheetNative(storyId, onRows, onError, pageSize);
  }
  const likesRef = collection(db, 'stories', storyId, 'likes');
  const q = query(likesRef, orderBy('createdAt', 'desc'), limit(pageSize));
  return onSnapshot(
    q,
    (snap) => {
      const rows: StoryLikeRow[] = [];
      snap.forEach((d) => {
        const v = d.data();
        const ts = v?.createdAt;
        let createdAt = '';
        if (typeof ts === 'string') createdAt = ts;
        else if (ts && typeof (ts as any).toDate === 'function') createdAt = (ts as any).toDate().toISOString();
        rows.push({
          userId: d.id,
          createdAt,
          username: (v?.username as string) || 'User',
          avatarUrl: v?.avatarUrl,
        });
      });
      onRows(rows);
    },
    (e) => onError?.(e as Error)
  );
}

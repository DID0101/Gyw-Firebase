import { Platform } from 'react-native';
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { addStoryNative, getStoryNative, getUserStoriesNative, hasNativeFirestore, toggleLikeStoryNative, viewStoryNative } from '@/lib/firestoreNative';

export interface Story {
  id: string;
  userId: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  thumbnailUrl?: string; // For video stories
  caption?: string;
  createdAt: string;
  expiresAt: string; // createdAt + 24h
  viewers: Array<{ userId: string; viewedAt: string }>;
  likes: string[]; // Array of user IDs
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
      viewers: [],
      likes: [],
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

// Mark story as viewed
export const viewStory = async (storyId: string, userId: string): Promise<void> => {
  try {
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      await viewStoryNative(storyId, userId);
      return;
    }
    const storyRef = doc(db, 'stories', storyId);
    const storyDoc = await getDoc(storyRef);
    if (!storyDoc.exists()) return;
    const data = storyDoc.data();
    const viewers = data.viewers || [];
    const alreadyViewed = viewers.some((v: { userId: string }) => v.userId === userId);
    if (!alreadyViewed) {
      await updateDoc(storyRef, {
        viewers: arrayUnion({ userId, viewedAt: new Date().toISOString() }),
      });
    }
  } catch (error) {
    if (__DEV__) console.error('Error viewing story:', error);
    throw error;
  }
};

// Like/unlike a story
export const toggleLikeStory = async (storyId: string, userId: string): Promise<boolean> => {
  try {
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      return toggleLikeStoryNative(storyId, userId);
    }
    const storyRef = doc(db, 'stories', storyId);
    const storyDoc = await getDoc(storyRef);
    if (!storyDoc.exists()) throw new Error('Story not found');
    const data = storyDoc.data();
    const likes = data.likes || [];
    const isLiked = likes.includes(userId);
    if (isLiked) {
      await updateDoc(storyRef, { likes: arrayRemove(userId) });
      return false;
    }
    await updateDoc(storyRef, { likes: arrayUnion(userId) });
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

// Get story viewers
export const getStoryViewers = async (storyId: string): Promise<Array<{ userId: string; viewedAt: string }>> => {
  try {
    const story = await getStory(storyId);
    return story?.viewers || [];
  } catch (error) {
    if (__DEV__) console.error('Error getting story viewers:', error);
    throw error;
  }
};


import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Story } from '@/lib/services/storyService';
import { useStoryStore } from '@/store/storyStore';
import { hasNativeFirestore, subscribeToStoriesNative } from '@/lib/firestoreNative';

export const useStories = () => {
  const [loading, setLoading] = useState(true);

  const allStories = useStoryStore((state) => state.allStories);
  const setStories = useStoryStore((state) => state.setStories);

  useEffect(() => {
    const cachedStories = useStoryStore.getState().allStories;
    if (cachedStories && cachedStories.length > 0) {
      setLoading(false);
    }

    if (Platform.OS !== 'web' && hasNativeFirestore) {
      const unsubscribe = subscribeToStoriesNative(
        (storiesData) => {
          setStories(storiesData as Story[]);
          setLoading(false);
        },
        () => setLoading(false)
      );
      return unsubscribe;
    }

    const now = Timestamp.now();
    const storiesRef = collection(db, 'stories');
    const q = query(storiesRef, where('expiresAt', '>', now));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const storiesData: Story[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          storiesData.push({
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
        storiesData.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setStories(storiesData);
        setLoading(false);
      },
      (error) => {
        if (__DEV__) console.error('Error listening to stories:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [setStories]);

  return { stories: allStories, loading };
};


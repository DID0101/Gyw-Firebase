import { create } from 'zustand';
import { Story } from '@/lib/services/storyService';
import { persistence } from './persistence';

interface StoryStore {
  // Stories grouped by user: { userId: Story[] }
  storiesByUser: Record<string, Story[]>;
  
  // All active stories (flat list)
  allStories: Story[];
  
  // Last update timestamp
  lastUpdated: number;
  
  // Actions
  setStories: (stories: Story[]) => void;
  setUserStories: (userId: string, stories: Story[]) => void;
  addStory: (story: Story) => void;
  updateStory: (storyId: string, updates: Partial<Story>) => void;
  removeStory: (storyId: string) => void;
  clearAll: () => void;
  // Persistence
  loadFromStorage: () => void;
}

export const useStoryStore = create<StoryStore>((set) => ({
  storiesByUser: {},
  allStories: [],
  lastUpdated: 0,
  
  setStories: (stories) => {
    set((state) => {
      // Group stories by user
      const storiesByUser: Record<string, Story[]> = {};
      
      stories.forEach((story) => {
        if (!storiesByUser[story.userId]) {
          storiesByUser[story.userId] = [];
        }
        storiesByUser[story.userId].push(story);
      });
      
      // Sort each user's stories by createdAt (newest first)
      Object.keys(storiesByUser).forEach((userId) => {
        storiesByUser[userId].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
      
      // Persist to AsyncStorage (async, don't block)
      persistence.saveStories(stories).catch(() => {});
      
      return {
        storiesByUser,
        allStories: stories,
        lastUpdated: Date.now(),
      };
    });
  },
  
  setUserStories: (userId, stories) => {
    set((state) => {
      // Sort stories by createdAt (newest first)
      const sortedStories = [...stories].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      return {
        storiesByUser: {
          ...state.storiesByUser,
          [userId]: sortedStories,
        },
        lastUpdated: Date.now(),
      };
    });
  },
  
  addStory: (story) => {
    set((state) => {
      // Check if story already exists
      if (state.allStories.some(s => s.id === story.id)) {
        return state;
      }
      
      const newAllStories = [...state.allStories, story];
      const userStories = state.storiesByUser[story.userId] || [];
      
      // Check if story already exists for this user
      if (!userStories.some(s => s.id === story.id)) {
        const newUserStories = [...userStories, story].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        
        return {
          storiesByUser: {
            ...state.storiesByUser,
            [story.userId]: newUserStories,
          },
          allStories: newAllStories,
          lastUpdated: Date.now(),
        };
      }
      
      return {
        allStories: newAllStories,
        lastUpdated: Date.now(),
      };
    });
  },
  
  updateStory: (storyId, updates) => {
    set((state) => {
      // Update in allStories
      const allStoriesIndex = state.allStories.findIndex(s => s.id === storyId);
      if (allStoriesIndex === -1) {
        return state;
      }
      
      const updatedAllStories = [...state.allStories];
      updatedAllStories[allStoriesIndex] = {
        ...updatedAllStories[allStoriesIndex],
        ...updates,
      };
      
      // Find which user owns this story
      const story = updatedAllStories[allStoriesIndex];
      const userStories = state.storiesByUser[story.userId] || [];
      const userStoriesIndex = userStories.findIndex(s => s.id === storyId);
      
      let updatedStoriesByUser = state.storiesByUser;
      if (userStoriesIndex !== -1) {
        const updatedUserStories = [...userStories];
        updatedUserStories[userStoriesIndex] = story;
        
        updatedStoriesByUser = {
          ...state.storiesByUser,
          [story.userId]: updatedUserStories,
        };
      }
      
      return {
        storiesByUser: updatedStoriesByUser,
        allStories: updatedAllStories,
        lastUpdated: Date.now(),
      };
    });
  },
  
  removeStory: (storyId) => {
    set((state) => {
      const story = state.allStories.find(s => s.id === storyId);
      if (!story) {
        return state;
      }
      
      const newAllStories = state.allStories.filter(s => s.id !== storyId);
      const userStories = state.storiesByUser[story.userId] || [];
      const newUserStories = userStories.filter(s => s.id !== storyId);
      
      return {
        storiesByUser: {
          ...state.storiesByUser,
          [story.userId]: newUserStories,
        },
        allStories: newAllStories,
        lastUpdated: Date.now(),
      };
    });
  },
  
  clearAll: () => {
    set({
      storiesByUser: {},
      allStories: [],
      lastUpdated: 0,
    });
  },
  
  // Load data from MMKV storage
  loadFromStorage: () => {
    persistence.loadStories().then((stories) => {
      const storiesByUser: Record<string, Story[]> = {};
      stories.forEach((story) => {
        if (!storiesByUser[story.userId]) {
          storiesByUser[story.userId] = [];
        }
        storiesByUser[story.userId].push(story);
      });
      Object.keys(storiesByUser).forEach((userId) => {
        storiesByUser[userId].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
      set({ storiesByUser, allStories: stories, lastUpdated: Date.now() });
    }).catch(() => {});
  },
}));


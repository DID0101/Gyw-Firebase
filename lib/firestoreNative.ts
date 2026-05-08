/**
 * Native Firestore helpers for React Native.
 * Use these when on native to access Firestore with native auth.
 * Uses single app from rnFirebase (same as Auth, Functions) - modular API only.
 */

import { GYW_AI_DISPLAY_NAME, GYW_AI_SYSTEM_ID } from '@/lib/constants/gywAi';
import { getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';
import { Platform } from 'react-native';

/** Firestore rejects undefined - strip it before writing. Export for use in layout/sign-up. */
export function sanitizeForFirestore(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

let rnFirestore: {
  getFirestore: () => any;
  collection: (parent: any, path: string, ...pathSegments: string[]) => any;
  doc: (parent: any, path: string, ...pathSegments: string[]) => any;
  query: (query: any, ...constraints: any[]) => any;
  where: (field: string, op: string, value: any) => any;
  orderBy: (field: string, direction?: string) => any;
  limit: (n: number) => any;
  startAfter: (...fieldValues: any[]) => any;
  getDocs: (q: any) => Promise<any>;
  getDoc: (ref: any) => Promise<any>;
  setDoc: (ref: any, data: any, options?: any) => Promise<void>;
  addDoc: (ref: any, data: any) => Promise<any>;
  updateDoc: (ref: any, data: any) => Promise<void>;
  deleteDoc: (ref: any) => Promise<void>;
  onSnapshot: (ref: any, onNext: (snap: any) => void, onError?: (err: any) => void) => () => void;
  serverTimestamp: () => any;
  arrayUnion: (...args: any[]) => any;
  arrayRemove: (...args: any[]) => any;
  Timestamp: { now: () => any; fromDate: (d: Date) => any };
  FieldValue: { increment: (n: number) => any };
} | null = null;

if (Platform.OS !== 'web' && hasRnFirebase) {
  try {
    const firestoreModule = require('@react-native-firebase/firestore');
    rnFirestore = {
      getFirestore: () => getRnFirestore(),
      collection: firestoreModule.collection,
      doc: firestoreModule.doc,
      query: firestoreModule.query,
      where: firestoreModule.where,
      orderBy: firestoreModule.orderBy,
      limit: firestoreModule.limit,
      startAfter: firestoreModule.startAfter,
      getDocs: firestoreModule.getDocs,
      getDoc: firestoreModule.getDoc,
      setDoc: firestoreModule.setDoc,
      addDoc: firestoreModule.addDoc,
      updateDoc: firestoreModule.updateDoc,
      deleteDoc: firestoreModule.deleteDoc,
      onSnapshot: firestoreModule.onSnapshot,
      serverTimestamp: firestoreModule.serverTimestamp,
      arrayUnion: firestoreModule.arrayUnion,
      arrayRemove: firestoreModule.arrayRemove,
      Timestamp: firestoreModule.Timestamp,
      FieldValue: firestoreModule.FieldValue,
    };
  } catch (e) {}
}

export const hasNativeFirestore = Platform.OS !== 'web' && !!rnFirestore;

/** Same shape as Firestore auto-ids (20 chars, A–Z a–z 0–9) for batch.set without addDoc. */
function newNativeMessageDocId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(20);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 20; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let id = '';
  for (let i = 0; i < 20; i++) id += chars[bytes[i]! % chars.length];
  return id;
}

export function getNativeFirestore() {
  return getRnFirestore();
}

/** Subscribe to chats where user is participant, ordered by lastMessageAt desc (native API). Returns unsubscribe. */
export function subscribeToChatsNative(
  userId: string,
  onChats: (chats: any[]) => void,
  onError?: (err: Error) => void
): () => void {
  if (!hasNativeFirestore || !rnFirestore) {
    onChats([]);
    if (onError) onError(new Error('Native Firestore not available'));
    return () => {};
  }
  const db = rnFirestore.getFirestore();
  const q = rnFirestore.query(
    rnFirestore.collection(db, 'chats'),
    rnFirestore.where('participants', 'array-contains', userId),
    rnFirestore.orderBy('lastMessageAt', 'desc')
  );
  const unsubscribe = rnFirestore.onSnapshot(
    q,
    (snapshot: any) => {
      const chats: any[] = [];
      snapshot.forEach((docSnap: any) => {
        const data = docSnap.data();
        chats.push({
          id: docSnap.id,
          ...data,
          lastMessageAt: data.lastMessageAt?.toDate?.()?.toISOString() || data.lastMessageAt || data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt || data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
          lastSenderId: data.lastSenderId ?? data.lastMessage?.senderId,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
        });
      });
      onChats(chats);
    },
    (err: any) => {
      if (__DEV__) console.error('[subscribeToChatsNative] Snapshot error:', err);
      if (onError) onError(err);
    }
  );
  return unsubscribe;
}

/** Get chats where user is participant, ordered by lastMessageAt desc (native API) */
export async function getChatsNative(userId: string, limitCount: number = 20) {
  if (!hasNativeFirestore || !rnFirestore) return [];
  const db = rnFirestore.getFirestore();
  const q = rnFirestore.query(
    rnFirestore.collection(db, 'chats'),
    rnFirestore.where('participants', 'array-contains', userId),
    rnFirestore.orderBy('lastMessageAt', 'desc'),
    rnFirestore.limit(limitCount)
  );
  const snapshot = await rnFirestore.getDocs(q);
  const chats: any[] = [];
  snapshot.forEach((docSnap: any) => {
    const data = docSnap.data();
    chats.push({
      id: docSnap.id,
      ...data,
      lastMessageAt: data.lastMessageAt?.toDate?.()?.toISOString() || data.lastMessageAt || data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt || data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      lastSenderId: data.lastSenderId ?? data.lastMessage?.senderId,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
    });
  });
  return chats;
}

/** Get call history (native API) */
export async function getCallHistoryNative(userId: string, limitCount: number = 50) {
  if (!hasNativeFirestore || !rnFirestore) return [];
  const db = rnFirestore.getFirestore();
  const [callerSnap, receiverSnap] = await Promise.all([
    rnFirestore.getDocs(rnFirestore.query(rnFirestore.collection(db, 'calls'), rnFirestore.where('callerId', '==', userId))),
    rnFirestore.getDocs(rnFirestore.query(rnFirestore.collection(db, 'calls'), rnFirestore.where('receiverId', '==', userId))),
  ]);
  const calls: any[] = [];
  callerSnap.forEach((docSnap: any) => {
    const data = docSnap.data();
    calls.push({ id: docSnap.id, ...data, direction: 'outgoing', createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt, endedAt: data.endedAt?.toDate?.()?.toISOString() || data.endedAt });
  });
  receiverSnap.forEach((docSnap: any) => {
    const data = docSnap.data();
    calls.push({ id: docSnap.id, ...data, direction: 'incoming', createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt, endedAt: data.endedAt?.toDate?.()?.toISOString() || data.endedAt });
  });
  calls.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return calls.filter(c => ['ended', 'missed', 'rejected'].includes(c.status)).slice(0, limitCount);
}

/** Get active stories (native API) */
export async function getStoriesNative() {
  if (!hasNativeFirestore || !rnFirestore) return [];
  const db = rnFirestore.getFirestore();
  const now = rnFirestore.Timestamp.now();
  const q = rnFirestore.query(
    rnFirestore.collection(db, 'stories'),
    rnFirestore.where('expiresAt', '>', now)
  );
  const snapshot = await rnFirestore.getDocs(q);
  const stories: any[] = [];
  snapshot.forEach((docSnap: any) => {
    const data = docSnap.data();
    stories.push({
      id: docSnap.id,
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
  stories.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return stories;
}

/** Get stories for a specific user (native API) */
export async function getUserStoriesNative(userId: string): Promise<any[]> {
  if (!hasNativeFirestore || !rnFirestore) return [];
  const db = rnFirestore.getFirestore();
  const q = rnFirestore.query(
    rnFirestore.collection(db, 'stories'),
    rnFirestore.where('userId', '==', userId)
  );
  const snapshot = await rnFirestore.getDocs(q);
  const now = new Date();
  const stories: any[] = [];
  snapshot.forEach((docSnap: any) => {
    const data = docSnap.data();
    const expiresAt = data.expiresAt?.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
    if (expiresAt > now) {
      stories.push({
        id: docSnap.id,
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
}

/** Add a story document (native API). Returns the new story doc id. */
export async function addStoryNative(storyData: Record<string, any>): Promise<string> {
  if (!hasNativeFirestore || !rnFirestore) throw new Error('Native Firestore not available');
  const db = rnFirestore.getFirestore();
  const { createdAt: _c, expiresAt: exp, ...rest } = sanitizeForFirestore(storyData);
  const docRef = await rnFirestore.addDoc(rnFirestore.collection(db, 'stories'), {
    ...rest,
    createdAt: rnFirestore.serverTimestamp(),
    expiresAt: rnFirestore.Timestamp.fromDate(new Date(exp || Date.now() + 24 * 60 * 60 * 1000)),
  });
  return docRef.id;
}

/** Get a single story by ID (native API) */
export async function getStoryNative(storyId: string): Promise<any | null> {
  if (!hasNativeFirestore || !rnFirestore) return null;
  const db = rnFirestore.getFirestore();
  const snap = await rnFirestore.getDoc(rnFirestore.doc(db, 'stories', storyId));
  if (!snap.exists) return null;
  const data = snap.data();
  return {
    id: snap.id,
    userId: data?.userId,
    mediaUrl: data?.mediaUrl,
    mediaType: data?.mediaType,
    thumbnailUrl: data?.thumbnailUrl,
    caption: data?.caption,
    createdAt: data?.createdAt?.toDate?.()?.toISOString() || data?.createdAt || new Date().toISOString(),
    expiresAt: data?.expiresAt?.toDate?.()?.toISOString() || data?.expiresAt || new Date().toISOString(),
    viewers: data?.viewers || [],
    likes: data?.likes || [],
  };
}

/** Mark story as viewed (native API) */
export async function viewStoryNative(storyId: string, userId: string): Promise<void> {
  if (!hasNativeFirestore || !rnFirestore) return;
  const db = rnFirestore.getFirestore();
  const ref = rnFirestore.doc(db, 'stories', storyId);
  const snap = await rnFirestore.getDoc(ref);
  if (!snap.exists) return;
  const data = snap.data();
  const viewers = data?.viewers || [];
  if (viewers.some((v: { userId: string }) => v.userId === userId)) return;
  await rnFirestore.updateDoc(ref, {
    viewers: rnFirestore.arrayUnion({ userId, viewedAt: new Date().toISOString() }),
  });
}

/** Like/unlike a story (native API). Returns new liked state (true = liked). */
export async function toggleLikeStoryNative(storyId: string, userId: string): Promise<boolean> {
  if (!hasNativeFirestore || !rnFirestore) throw new Error('Native Firestore not available');
  const db = rnFirestore.getFirestore();
  const ref = rnFirestore.doc(db, 'stories', storyId);
  const snap = await rnFirestore.getDoc(ref);
  if (!snap.exists) throw new Error('Story not found');
  const data = snap.data();
  const likes: string[] = data?.likes || [];
  const isLiked = likes.includes(userId);
  if (isLiked) {
    await rnFirestore.updateDoc(ref, { likes: rnFirestore.arrayRemove(userId) });
    return false;
  }
  await rnFirestore.updateDoc(ref, { likes: rnFirestore.arrayUnion(userId) });
  return true;
}

/** Subscribe to active stories in real time (native API). Returns unsubscribe function. */
export function subscribeToStoriesNative(
  onStories: (stories: any[]) => void,
  onError?: (err: Error) => void
): () => void {
  if (!hasNativeFirestore || !rnFirestore) {
    onStories([]);
    if (onError) onError(new Error('Native Firestore not available'));
    return () => {};
  }
  const db = rnFirestore.getFirestore();
  const now = rnFirestore.Timestamp.now();
  const q = rnFirestore.query(
    rnFirestore.collection(db, 'stories'),
    rnFirestore.where('expiresAt', '>', now)
  );
  const unsubscribe = rnFirestore.onSnapshot(
    q,
    (snapshot: any) => {
      const stories: any[] = [];
      snapshot.forEach((docSnap: any) => {
        const data = docSnap.data();
        stories.push({
          id: docSnap.id,
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
      stories.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      onStories(stories);
    },
    (err: any) => {
      if (__DEV__) console.error('Error listening to stories:', err);
      if (onError) onError(err);
    }
  );
  return unsubscribe;
}

/** Get all users (native API) - for useUsers */
export async function getUsersNative(): Promise<any[]> {
  if (!hasNativeFirestore || !rnFirestore) return [];
  const db = rnFirestore.getFirestore();
  const q = rnFirestore.query(
    rnFirestore.collection(db, 'users'),
    rnFirestore.orderBy('username', 'asc')
  );
  const snapshot = await rnFirestore.getDocs(q);
  const users: any[] = [];
  snapshot.forEach((docSnap: any) => {
    const data = docSnap.data();
    users.push({
      uid: docSnap.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
    });
  });
  return users;
}

/** Get user doc by uid (native API) - for useUsersData and profile */
export async function getUserDocNative(uid: string): Promise<any | null> {
  if (!hasNativeFirestore || !rnFirestore) return null;
  const db = rnFirestore.getFirestore();
  const snap = await rnFirestore.getDoc(rnFirestore.doc(db, 'users', uid));
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  return { id: snap.id, ...data };
}

/** Update user doc (native API) - for profile */
export async function updateUserDocNative(uid: string, data: Record<string, any>): Promise<void> {
  if (!hasNativeFirestore || !rnFirestore) throw new Error('Native Firestore not available');
  const db = rnFirestore.getFirestore();
  await rnFirestore.setDoc(rnFirestore.doc(db, 'users', uid), sanitizeForFirestore(data), { merge: true });
}

/** Normalize message doc from Firestore to ChatMessage shape */
function normalizeMessageDoc(docId: string, chatId: string, data: any): any {
  return {
    id: docId,
    chatId,
    ...data,
    createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
    sentAt: data.sentAt?.toDate?.()?.toISOString() || data.sentAt,
    deliveredAt: data.deliveredAt?.toDate?.()?.toISOString() || data.deliveredAt,
    seenAt: data.seenAt?.toDate?.()?.toISOString() || data.seenAt,
    edited: data.edited || false,
    editedAt: data.editedAt?.toDate?.()?.toISOString() || data.editedAt,
    deleted: data.deleted || false,
    deletedFor: data.deletedFor || [],
  };
}

/** Get chat messages (native API) - for warmChat / preload */
export async function getChatMessagesNative(chatId: string, limitCount: number = 20): Promise<any[]> {
  if (!hasNativeFirestore || !rnFirestore) return [];
  const db = rnFirestore.getFirestore();
  const messagesRef = rnFirestore.collection(rnFirestore.doc(db, 'chats', chatId), 'messages');
  const q = rnFirestore.query(
    messagesRef,
    rnFirestore.orderBy('createdAt', 'desc'),
    rnFirestore.limit(limitCount)
  );
  const snapshot = await rnFirestore.getDocs(q);
  const messages: any[] = [];
  snapshot.forEach((docSnap: any) => {
    const data = docSnap.data();
    messages.push(normalizeMessageDoc(docSnap.id, chatId, data));
  });
  return messages;
}

/** Subscribe to chat messages (native API). Returns unsubscribe. */
export function subscribeToChatMessagesNative(
  chatId: string,
  pageSize: number,
  onMessages: (messages: any[]) => void,
  onError?: (err: Error) => void
): () => void {
  if (!hasNativeFirestore || !rnFirestore) {
    onMessages([]);
    if (onError) onError(new Error('Native Firestore not available'));
    return () => {};
  }
  const db = rnFirestore.getFirestore();
  const messagesRef = rnFirestore.collection(rnFirestore.doc(db, 'chats', chatId), 'messages');
  const q = rnFirestore.query(
    messagesRef,
    rnFirestore.orderBy('createdAt', 'desc'),
    rnFirestore.limit(pageSize)
  );
  const unsubscribe = rnFirestore.onSnapshot(
    q,
    (snapshot: any) => {
      const messages: any[] = [];
      snapshot.forEach((docSnap: any) => {
        const data = docSnap.data();
        messages.push(normalizeMessageDoc(docSnap.id, chatId, data));
      });
      onMessages(messages);
    },
    (err: any) => {
      if (__DEV__) console.error('Native message listener error:', err);
      if (onError) onError(err);
    }
  );
  return unsubscribe;
}

/** One page of messages strictly older than the given message (same orderBy as live listener: createdAt desc). */
export async function fetchOlderMessagesAfterNative(
  chatId: string,
  oldestMessageId: string,
  pageSize: number
): Promise<any[]> {
  if (!hasNativeFirestore || !rnFirestore || typeof rnFirestore.startAfter !== 'function') {
    return [];
  }
  const db = rnFirestore.getFirestore();
  const messagesRef = rnFirestore.collection(rnFirestore.doc(db, 'chats', chatId), 'messages');
  const oldestRef = rnFirestore.doc(db, 'chats', chatId, 'messages', oldestMessageId);
  const oldestSnap = await rnFirestore.getDoc(oldestRef);
  if (!oldestSnap.exists) return [];
  const q = rnFirestore.query(
    messagesRef,
    rnFirestore.orderBy('createdAt', 'desc'),
    rnFirestore.startAfter(oldestSnap),
    rnFirestore.limit(pageSize)
  );
  const snapshot = await rnFirestore.getDocs(q);
  const messages: any[] = [];
  snapshot.forEach((docSnap: any) => {
    messages.push(normalizeMessageDoc(docSnap.id, chatId, docSnap.data()));
  });
  return messages;
}

/** Subscribe to a chat document (native API). Returns unsubscribe. */
export function subscribeToChatDocNative(
  chatId: string,
  onSnapshot: (data: { id: string; [k: string]: any } | null) => void,
  onError?: (err: Error) => void
): () => void {
  if (!hasNativeFirestore || !rnFirestore) {
    onSnapshot(null);
    if (onError) onError(new Error('Native Firestore not available'));
    return () => {};
  }
  const db = rnFirestore.getFirestore();
  const ref = rnFirestore.doc(db, 'chats', chatId);
  const unsubscribe = rnFirestore.onSnapshot(
    ref,
    (snap: any) => {
      if (!snap.exists) {
        onSnapshot(null);
        return;
      }
      const data = snap.data();
      onSnapshot({
        id: snap.id,
        ...data,
        lastMessageAt: data.lastMessageAt?.toDate?.()?.toISOString() || data.lastMessageAt,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
      });
    },
    (err: any) => {
      if (__DEV__) console.error('Native chat doc listener error:', err);
      if (onError) onError(err);
    }
  );
  return unsubscribe;
}

/** Subscribe to a user document (native API). Returns unsubscribe. */
export function subscribeToUserDocNative(
  uid: string,
  onSnapshot: (data: { id: string; [k: string]: any } | null) => void,
  onError?: (err: Error) => void
): () => void {
  if (!hasNativeFirestore || !rnFirestore) {
    onSnapshot(null);
    if (onError) onError(new Error('Native Firestore not available'));
    return () => {};
  }
  const db = rnFirestore.getFirestore();
  const ref = rnFirestore.doc(db, 'users', uid);
  const unsubscribe = rnFirestore.onSnapshot(
    ref,
    (snap: any) => {
      if (!snap.exists) {
        onSnapshot(null);
        return;
      }
      const data = snap.data() ?? {};
      onSnapshot({
        id: snap.id,
        ...data,
        lastActive: (data as any).lastActive?.toDate?.()?.toISOString() ?? (data as any).lastActive,
        createdAt: (data as any).createdAt?.toDate?.()?.toISOString() || (data as any).createdAt,
        updatedAt: (data as any).updatedAt?.toDate?.()?.toISOString() || (data as any).updatedAt,
      });
    },
    (err: any) => {
      if (__DEV__) console.error('Native user doc listener error:', err);
      if (onError) onError(err);
    }
  );
  return unsubscribe;
}

/** Add a message to a chat (native API). Returns the new message doc id. */
export async function addMessageNative(chatId: string, messageData: Record<string, any>): Promise<string> {
  if (!hasNativeFirestore || !rnFirestore) throw new Error('Native Firestore not available');
  const db = rnFirestore.getFirestore();
  const data = sanitizeForFirestore(messageData);
  const docData = { ...data, createdAt: rnFirestore.serverTimestamp() };
  const messagesRef = rnFirestore.collection(rnFirestore.doc(db, 'chats', chatId), 'messages');
  const docRef = await rnFirestore.addDoc(messagesRef, docData);
  return docRef.id;
}

/**
 * One round-trip: new message + chat lastMessage + unread increments for known recipients.
 * Avoids getDoc before every send (major latency win vs addMessage + incrementUnread).
 */
export async function addMessageAndUpdateChatNativeBatch(
  chatId: string,
  messageData: Record<string, any>,
  lastMessagePreview: { text: string; senderId: string; createdAt: string },
  otherUserIds: string[]
): Promise<string> {
  if (!hasNativeFirestore || !rnFirestore) throw new Error('Native Firestore not available');
  const db = rnFirestore.getFirestore();
  const data = sanitizeForFirestore(messageData);
  const docData = { ...data, createdAt: rnFirestore.serverTimestamp() };
  const chatRef = rnFirestore.doc(db, 'chats', chatId);
  const msgRef = rnFirestore.doc(db, 'chats', chatId, 'messages', newNativeMessageDocId());
  const serverTs = rnFirestore.serverTimestamp();
  const inc = rnFirestore.FieldValue.increment(1);
  const chatUpdates: Record<string, any> = {
    lastMessage: lastMessagePreview,
    lastMessageAt: serverTs,
    lastSenderId: lastMessagePreview.senderId,
    updatedAt: serverTs,
  };
  for (const uid of otherUserIds) {
    if (uid && uid !== lastMessagePreview.senderId) {
      chatUpdates[`unreadCount.${uid}`] = inc;
    }
  }
  const batch = db.batch();
  batch.set(msgRef, docData);
  batch.update(chatRef, chatUpdates);
  await batch.commit();
  return msgRef.id;
}

/** Set typing indicator (native API) */
export async function setTypingIndicatorNative(chatId: string, userId: string, isTyping: boolean): Promise<void> {
  if (!hasNativeFirestore || !rnFirestore) return;
  const db = rnFirestore.getFirestore();
  const ref = rnFirestore.doc(db, 'chats', chatId);
  try {
    if (isTyping) {
      await rnFirestore.updateDoc(ref, { [`typing.${userId}`]: { at: rnFirestore.serverTimestamp() } } as any);
    } else {
      const { deleteField } = require('@react-native-firebase/firestore');
      await rnFirestore.updateDoc(ref, { [`typing.${userId}`]: deleteField() } as any);
    }
  } catch (e) {
    if (__DEV__) console.warn('setTypingIndicatorNative:', e);
  }
}

/** Update chat's lastMessage, lastSenderId and timestamps (native API) */
export async function updateChatLastMessageNative(
  chatId: string,
  lastMessage: { text: string; senderId: string; createdAt: string }
): Promise<void> {
  if (!hasNativeFirestore || !rnFirestore) throw new Error('Native Firestore not available');
  const db = rnFirestore.getFirestore();
  const ref = rnFirestore.doc(db, 'chats', chatId);
  const serverTs = rnFirestore.serverTimestamp();
  await rnFirestore.updateDoc(ref, {
    lastMessage,
    lastMessageAt: serverTs,
    lastSenderId: lastMessage.senderId,
    updatedAt: serverTs,
  });
}

/** Increment unread count for all participants except sender (native API). Atomic. */
export async function incrementUnreadForOtherParticipantsNative(
  chatId: string,
  senderId: string
): Promise<void> {
  if (!hasNativeFirestore || !rnFirestore) return;
  const db = rnFirestore.getFirestore();
  const chatRef = rnFirestore.doc(db, 'chats', chatId);
  const snap = await rnFirestore.getDoc(chatRef);
  if (!snap.exists) return;
  const data = snap.data();
  const participants: string[] = data?.participants || [];
  const others = participants.filter((id: string) => id !== senderId);
  if (others.length === 0) return;
  const inc = rnFirestore.FieldValue.increment(1);
  const updateData: Record<string, any> = { updatedAt: rnFirestore.serverTimestamp() };
  others.forEach((uid: string) => {
    updateData[`unreadCount.${uid}`] = inc;
  });
  await rnFirestore.updateDoc(chatRef, updateData);
}

/** Reset unread count for user when they open chat (native API). */
export async function markMessagesAsReadNative(chatId: string, userId: string): Promise<void> {
  if (!hasNativeFirestore || !rnFirestore) return;
  const db = rnFirestore.getFirestore();
  const chatRef = rnFirestore.doc(db, 'chats', chatId);
  // Use field path update — atomic, does not overwrite other participants' unread counts.
  await rnFirestore.updateDoc(chatRef, {
    [`unreadCount.${userId}`]: 0,
    updatedAt: rnFirestore.serverTimestamp(),
  });
}

export async function markMessageAsDeliveredNative(chatId: string, messageId: string): Promise<void> {
  if (!hasNativeFirestore || !rnFirestore) return;
  const db = rnFirestore.getFirestore();
  const ref = rnFirestore.doc(db, 'chats', chatId, 'messages', messageId);
  const now = new Date().toISOString();
  await rnFirestore.updateDoc(ref, {
    status: 'delivered',
    deliveredAt: now,
    updatedAt: rnFirestore.serverTimestamp(),
  });
}

export type MarkMessageSeenHintNative = {
  chatType?: 'direct' | 'group';
  messageReadBy?: string[];
  messageSenderId?: string;
  chatParticipants?: string[];
};

export async function markMessageAsSeenNative(
  chatId: string,
  messageId: string,
  userId: string,
  hint?: MarkMessageSeenHintNative
): Promise<void> {
  if (!hasNativeFirestore || !rnFirestore) return;
  const db = rnFirestore.getFirestore();
  const ref = rnFirestore.doc(db, 'chats', chatId, 'messages', messageId);
  const knownSenderId = hint?.messageSenderId;
  const knownReadBy = hint?.messageReadBy;
  const knownChatType = hint?.chatType;
  const knownParticipants = hint?.chatParticipants;

  if (knownSenderId && knownSenderId === userId) return;

  if (knownChatType === 'direct') {
    if (knownReadBy?.includes(userId)) return;
    const now = new Date().toISOString();
    await rnFirestore.updateDoc(ref, {
      status: 'seen',
      seenAt: now,
      readBy: [...(knownReadBy ?? []), userId],
      updatedAt: rnFirestore.serverTimestamp(),
    });
    return;
  }

  if (knownChatType === 'group' && knownReadBy !== undefined) {
    if (knownReadBy.includes(userId)) return;
    const nextReadBy = [...knownReadBy, userId];
    await rnFirestore.updateDoc(ref, {
      readBy: nextReadBy,
      updatedAt: rnFirestore.serverTimestamp(),
    });
    if (knownParticipants && knownSenderId) {
      const otherParticipants = knownParticipants.filter((p: string) => p !== knownSenderId);
      const allRead = otherParticipants.every((p: string) => nextReadBy.includes(p));
      if (allRead) {
        const now = new Date().toISOString();
        await rnFirestore.updateDoc(ref, {
          status: 'seen',
          seenAt: now,
          updatedAt: rnFirestore.serverTimestamp(),
        });
      }
    }
    return;
  }

  const msgSnap = await rnFirestore.getDoc(ref);
  if (!msgSnap.exists()) return;
  const messageData = msgSnap.data() || {};
  if (messageData.senderId === userId) return;
  const chatRef = rnFirestore.doc(db, 'chats', chatId);
  const chatSnap = await rnFirestore.getDoc(chatRef);
  const chatData = chatSnap.data();
  const isGroupChat = chatData?.type === 'group';

  if (isGroupChat) {
    const readBy: string[] = messageData.readBy || [];
    if (!readBy.includes(userId)) {
      const nextRead = [...readBy, userId];
      await rnFirestore.updateDoc(ref, {
        readBy: nextRead,
        updatedAt: rnFirestore.serverTimestamp(),
      });
      const participants = chatData?.participants || [];
      const otherParticipants = participants.filter((p: string) => p !== messageData.senderId);
      const allRead = otherParticipants.every((p: string) => nextRead.includes(p));
      if (allRead && messageData.status !== 'seen') {
        const now = new Date().toISOString();
        await rnFirestore.updateDoc(ref, {
          status: 'seen',
          seenAt: now,
          updatedAt: rnFirestore.serverTimestamp(),
        });
      }
    }
  } else {
    if (messageData.status === 'delivered' || messageData.status === 'sent' || messageData.status == null) {
      const now = new Date().toISOString();
      const rb: string[] = messageData.readBy || [];
      if (rb.includes(userId)) return;
      await rnFirestore.updateDoc(ref, {
        status: 'seen',
        seenAt: now,
        readBy: [...rb, userId],
        updatedAt: rnFirestore.serverTimestamp(),
      });
    }
  }
}

/** Get or create direct chat (native API) - uses native auth for permission */
export async function getOrCreateDirectChatNative(userId1: string, userId2: string): Promise<string> {
  if (!hasNativeFirestore || !rnFirestore) throw new Error('Native Firestore not available');
  const db = rnFirestore.getFirestore();

  const q = rnFirestore.query(
    rnFirestore.collection(db, 'chats'),
    rnFirestore.where('type', '==', 'direct'),
    rnFirestore.where('participants', 'array-contains', userId1)
  );
  const snapshot = await rnFirestore.getDocs(q);

  const existing = snapshot.docs.find((d: any) => {
    const data = d.data();
    const participants = data.participants || [];
    return participants.length === 2 && participants.includes(userId1) && participants.includes(userId2);
  });
  if (existing) return existing.id;

  const [u1, u2] = await Promise.all([
    getUserDocNative(userId1),
    userId2 === GYW_AI_SYSTEM_ID ? Promise.resolve(null) : getUserDocNative(userId2),
  ]);
  const user1Data = u1 || {};
  const user2Data = u2 || {};

  const participantData: Record<string, any> = {};
  participantData[userId1] = {
    name: `${user1Data.firstName || ''} ${user1Data.lastName || ''}`.trim() || 'User',
    ...(user1Data.avatar && { avatar: user1Data.avatar }),
    ...(user1Data.username && { username: user1Data.username }),
  };
  participantData[userId2] = {
    ...(userId2 === GYW_AI_SYSTEM_ID
      ? { name: GYW_AI_DISPLAY_NAME }
      : {
          name: `${user2Data.firstName || ''} ${user2Data.lastName || ''}`.trim() || 'User',
          ...(user2Data.avatar && { avatar: user2Data.avatar }),
          ...(user2Data.username && { username: user2Data.username }),
        }),
  };

  const serverTs = rnFirestore.serverTimestamp();
  const newChat = sanitizeForFirestore({
    type: 'direct',
    participants: [userId1, userId2],
    participantData,
    unreadCount: { [userId1]: 0, [userId2]: 0 },
    createdAt: serverTs,
    updatedAt: serverTs,
    lastMessageAt: serverTs, // Required for chats list ordering (treat as createdAt when no messages)
  });

  const docRef = await rnFirestore.addDoc(rnFirestore.collection(db, 'chats'), newChat);
  return docRef.id;
}

// --- Call operations (for callService on native - uses RN Firebase Auth) ---

/** Create a call document (native API). Returns the new call doc id. */
export async function createCallNative(
  callerId: string,
  receiverId: string,
  type: 'audio' | 'video',
  chatId?: string,
  isRandom?: boolean,
  callerName?: string,
  callerAvatar?: string,
): Promise<string> {
  if (!hasNativeFirestore || !rnFirestore) throw new Error('Native Firestore not available');
  const db = rnFirestore.getFirestore();
  const callData: Record<string, any> = {
    callerId,
    receiverId,
    calleeId: receiverId, // mirrors receiverId so _layout.tsx Firestore listener (queries calleeId) fires
    type,
    status: 'ringing',
    createdAt: rnFirestore.serverTimestamp(),
  };
  if (chatId) callData.chatId = chatId;
  if (isRandom) callData.isRandom = true;
  if (callerName) callData.callerName = callerName;
  if (callerAvatar) callData.callerAvatar = callerAvatar;
  const docRef = await rnFirestore.addDoc(rnFirestore.collection(db, 'calls'), callData);
  return docRef.id;
}

/** Update call status (native API). Optionally creates call log message in chat. */
export async function updateCallStatusNative(
  callId: string,
  status: string,
  duration?: number,
  chatId?: string
): Promise<void> {
  if (!hasNativeFirestore || !rnFirestore) throw new Error('Native Firestore not available');
  const db = rnFirestore.getFirestore();
  const ref = rnFirestore.doc(db, 'calls', callId);
  const snap = await rnFirestore.getDoc(ref);
  if (!snap.exists) throw new Error('Call not found');
  const callData = snap.data();
  const updateData: Record<string, any> = {
    status,
    updatedAt: rnFirestore.serverTimestamp(),
  };
  if (status === 'ended' || status === 'missed' || status === 'rejected' || status === 'busy') {
    updateData.endedAt = rnFirestore.serverTimestamp();
  }
  if (duration !== undefined) updateData.duration = duration;
  if (chatId) updateData.chatId = chatId;
  await rnFirestore.updateDoc(ref, updateData);

  // Create call log message in chat if needed (don't fail the whole update if this fails)
  if (
    chatId &&
    !callData?.isRandom &&
    (status === 'ended' || status === 'missed' || status === 'rejected')
  ) {
    try {
      const callerUser = await getUserDocNative(callData.callerId);
      const senderName = callerUser
        ? `${callerUser.firstName || ''} ${callerUser.lastName || ''}`.trim() || callerUser.username
        : 'User';
      const callType = callData.type === 'video' ? '📹' : '📞';
      let messageText = '';
      if (status === 'missed') messageText = `${callType} Missed ${callData.type} call`;
      else if (status === 'rejected') messageText = `${callType} ${callData.type === 'video' ? 'Video' : 'Audio'} call • Rejected`;
      else if (duration && duration > 0) {
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        messageText = `${callType} ${callData.type === 'video' ? 'Video' : 'Audio'} call • ${minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`}`;
      } else messageText = `${callType} ${callData.type === 'video' ? 'Video' : 'Audio'} call`;
      await addMessageNative(chatId, {
        chatId,
        senderId: callData.callerId,
        senderName,
        text: messageText,
        type: 'call',
        callId,
        callType: callData.type,
        callStatus: status,
        callDuration: duration || 0,
        readBy: [callData.callerId, callData.receiverId],
      });
      await updateChatLastMessageNative(chatId, {
        text: messageText,
        senderId: callData.callerId,
        createdAt: new Date().toISOString(),
      });
      // Increment unread for receiver on missed/rejected (they didn't see it)
      if (status === 'missed' || status === 'rejected') {
        await incrementUnreadForOtherParticipantsNative(chatId, callData.callerId);
      }
    } catch (e) {
      if (__DEV__) console.error('Error creating call log message:', e);
    }
  }
}

/** Update call with receiverReady (native API). For random calls handshake. */
export async function updateCallReceiverReadyNative(callId: string): Promise<void> {
  if (!hasNativeFirestore || !rnFirestore) throw new Error('Native Firestore not available');
  const db = rnFirestore.getFirestore();
  const ref = rnFirestore.doc(db, 'calls', callId);
  await rnFirestore.updateDoc(ref, {
    receiverReady: true,
    receiverReadyAt: rnFirestore.serverTimestamp(),
    updatedAt: rnFirestore.serverTimestamp(),
  });
}

/** Get call by ID (native API). */
export async function getCallNative(callId: string): Promise<any | null> {
  if (!hasNativeFirestore || !rnFirestore) return null;
  const db = rnFirestore.getFirestore();
  const snap = await rnFirestore.getDoc(rnFirestore.doc(db, 'calls', callId));
  if (!snap.exists) return null;
  const data = snap.data();
  return {
    id: snap.id,
    ...data,
    createdAt: data?.createdAt?.toDate?.()?.toISOString() || data?.createdAt,
    endedAt: data?.endedAt?.toDate?.()?.toISOString() || data?.endedAt,
  };
}

/** Subscribe to call updates (native API). Returns unsubscribe. */
export function subscribeToCallNative(
  callId: string,
  onCall: (call: any | null) => void
): () => void {
  if (!hasNativeFirestore || !rnFirestore) {
    onCall(null);
    return () => {};
  }
  const db = rnFirestore.getFirestore();
  const ref = rnFirestore.doc(db, 'calls', callId);
  return rnFirestore.onSnapshot(
    ref,
    (snap: any) => {
      if (snap.exists) {
        const data = snap.data();
        onCall({
          id: snap.id,
          ...data,
          createdAt: data?.createdAt?.toDate?.()?.toISOString() || data?.createdAt,
          endedAt: data?.endedAt?.toDate?.()?.toISOString() || data?.endedAt,
        });
      } else {
        onCall(null);
      }
    },
    (err: any) => {
      if (__DEV__) console.error('Error listening to call:', err);
      onCall(null);
    }
  );
}

/** Send signaling message (native API). */
export async function sendSignalingMessageNative(
  callId: string,
  from: string,
  to: string,
  type: string,
  sdp?: any,
  candidate?: any
): Promise<void> {
  if (!hasNativeFirestore || !rnFirestore) throw new Error('Native Firestore not available');
  const db = rnFirestore.getFirestore();
  const messagesRef = rnFirestore.collection(rnFirestore.doc(db, 'callSignaling', callId), 'messages');
  const data: Record<string, any> = { from, to, type, timestamp: rnFirestore.serverTimestamp() };
  if (sdp) data.sdp = sdp;
  if (candidate) data.candidate = candidate;
  await rnFirestore.addDoc(messagesRef, data);
}

/** Subscribe to signaling messages (native API). Returns unsubscribe. */
export function subscribeToSignalingNative(
  callId: string,
  userId: string,
  onMessage: (msg: any) => void
): () => void {
  if (!hasNativeFirestore || !rnFirestore) return () => {};
  const db = rnFirestore.getFirestore();
  const messagesRef = rnFirestore.collection(rnFirestore.doc(db, 'callSignaling', callId), 'messages');
  return rnFirestore.onSnapshot(
    messagesRef,
    (snapshot: any) => {
      snapshot.docChanges().forEach((change: any) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data.to === userId) {
            onMessage({
              callId,
              from: data.from,
              to: data.to,
              type: data.type,
              ...(data.sdp && { sdp: data.sdp }),
              ...(data.candidate && { candidate: data.candidate }),
              timestamp: data.timestamp?.toDate?.()?.toISOString() || data.timestamp,
            });
          }
        }
      });
    },
    (err: any) => {
      if (err?.code === 'permission-denied') return;
      if (__DEV__) console.error('Error listening to signaling:', err);
    }
  );
}

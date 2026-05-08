import { GYW_AI_DISPLAY_NAME, GYW_AI_SYSTEM_ID } from '@/lib/constants/gywAi';
import { db, storage } from '@/lib/firebase';
import {
  addMessageAndUpdateChatNativeBatch,
  addMessageNative,
  getOrCreateDirectChatNative,
  getUserDocNative,
  hasNativeFirestore,
  incrementUnreadForOtherParticipantsNative,
  markMessageAsDeliveredNative,
  markMessageAsSeenNative,
  markMessagesAsReadNative,
  setTypingIndicatorNative,
  updateChatLastMessageNative,
} from '@/lib/firestoreNative';
import { Chat, User } from '@/lib/types/chat';
import {
    addDoc,
    collection,
    deleteField,
    doc,
    getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { Platform } from 'react-native';

// Helper function to remove undefined values from objects (Firestore doesn't allow undefined)
const removeUndefined = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(removeUndefined);
  }
  
  const cleaned: any = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      cleaned[key] = removeUndefined(obj[key]);
    }
  }
  return cleaned;
};

/** Optional fast path: skip extra Firestore read when recipient ids are already known (e.g. from chat.participants). */
export type SendChatMessageOptions = {
  recipientUserIds?: string[];
};

async function addWebMessageAndUpdateChatBatch(
  chatId: string,
  cleanedMessageData: Record<string, any>,
  lastMessagePreview: { text: string; senderId: string; createdAt: string },
  senderId: string,
  otherUserIds: string[]
): Promise<string> {
  const batch = writeBatch(db);
  const msgRef = doc(collection(db, 'chats', chatId, 'messages'));
  batch.set(msgRef, {
    ...cleanedMessageData,
    createdAt: serverTimestamp(),
  });
  const chatRef = doc(db, 'chats', chatId);
  const chatUpdates: Record<string, unknown> = {
    lastMessage: lastMessagePreview,
    lastMessageAt: serverTimestamp(),
    lastSenderId: senderId,
    updatedAt: serverTimestamp(),
  };
  for (const uid of otherUserIds) {
    if (uid && uid !== senderId) {
      chatUpdates[`unreadCount.${uid}`] = increment(1);
    }
  }
  batch.update(chatRef, chatUpdates as Record<string, any>);
  await batch.commit();
  return msgRef.id;
}

// Create or get a direct chat between two users
export const getOrCreateDirectChat = async (userId1: string, userId2: string): Promise<string> => {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    return getOrCreateDirectChatNative(userId1, userId2);
  }

  // Check if chat already exists
  const chatsRef = collection(db, 'chats');
  const q = query(
    chatsRef,
    where('type', '==', 'direct'),
    where('participants', 'array-contains', userId1)
  );

  const snapshot = await getDocs(q);
  let existingChat = snapshot.docs.find(
    (doc) => {
      const data = doc.data();
      return data.participants.length === 2 && 
             data.participants.includes(userId1) && 
             data.participants.includes(userId2);
    }
  );

  if (existingChat) {
    return existingChat.id;
  }

  // Fetch user data for both participants
  const [user1Doc, user2Doc] = await Promise.all([
    getDoc(doc(db, 'users', userId1)),
    getDoc(doc(db, 'users', userId2)),
  ]);

  const user1Data = user1Doc.exists() ? user1Doc.data() : null;
  const user2Data = user2Doc.exists() ? user2Doc.data() : null;

  // Create new chat with participant data (omit undefined values)
  const participantData: any = {};
  
  // User 1 data
  const user1Participant: any = {
    name: user1Data ? `${user1Data.firstName || ''} ${user1Data.lastName || ''}`.trim() : 'User',
  };
  if (user1Data?.avatar) {
    user1Participant.avatar = user1Data.avatar;
  }
  if (user1Data?.username) {
    user1Participant.username = user1Data.username;
  }
  participantData[userId1] = user1Participant;
  
  // User 2 data
  const user2Participant: any =
    userId2 === GYW_AI_SYSTEM_ID
      ? { name: GYW_AI_DISPLAY_NAME }
      : {
          name: user2Data ? `${user2Data.firstName || ''} ${user2Data.lastName || ''}`.trim() : 'User',
        };
  if (user2Data?.avatar) {
    user2Participant.avatar = user2Data.avatar;
  }
  if (user2Data?.username) {
    user2Participant.username = user2Data.username;
  }
  participantData[userId2] = user2Participant;

  const newChat: any = {
    type: 'direct',
    participants: [userId1, userId2],
    participantData: participantData,
    unreadCount: {
      [userId1]: 0,
      [userId2]: 0,
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(), // Required for chats list ordering (treat as createdAt when no messages)
  };

  const chatDocRef = doc(chatsRef);
  await setDoc(chatDocRef, removeUndefined(newChat));

  return chatDocRef.id;
};

// Send a text message
export const sendMessage = async (
  chatId: string,
  senderId: string,
  senderName: string,
  senderAvatar: string | undefined,
  text: string,
  replyTo?: { messageId: string; senderName: string; text?: string; type?: string },
  options?: SendChatMessageOptions
): Promise<string> => {
  const messageData: any = {
    chatId,
    senderId,
    senderName,
    text,
    type: 'text',
    readBy: [senderId],
  };
  if (senderAvatar !== undefined && senderAvatar !== null) {
    messageData.senderAvatar = senderAvatar;
  }
  if (replyTo) {
    messageData.replyTo = removeUndefined(replyTo);
  }
  const now = new Date().toISOString();
  messageData.status = 'sent';
  messageData.sentAt = now;
  const cleanedMessageData = removeUndefined(messageData);

  const lastPreview = {
    text: text.substring(0, 100),
    senderId,
    createdAt: now,
  };
  const otherIds = (options?.recipientUserIds ?? []).filter((id) => id && id !== senderId);
  const useParticipantBatch = otherIds.length > 0;

  let messageId: string;
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    if (useParticipantBatch) {
      messageId = await addMessageAndUpdateChatNativeBatch(
        chatId,
        cleanedMessageData,
        lastPreview,
        otherIds
      );
    } else {
      messageId = await addMessageNative(chatId, cleanedMessageData);
      await Promise.all([
        updateChatLastMessageNative(chatId, lastPreview),
        incrementUnreadForOtherParticipants(chatId, senderId),
      ]);
    }
  } else if (useParticipantBatch) {
    messageId = await addWebMessageAndUpdateChatBatch(
      chatId,
      cleanedMessageData,
      lastPreview,
      senderId,
      otherIds
    );
  } else {
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const docRef = await addDoc(messagesRef, {
      ...cleanedMessageData,
      createdAt: serverTimestamp(),
    });
    messageId = docRef.id;
    const chatRef = doc(db, 'chats', chatId);
    await Promise.all([
      updateDoc(chatRef, {
        lastMessage: lastPreview,
        lastMessageAt: serverTimestamp(),
        lastSenderId: senderId,
        updatedAt: serverTimestamp(),
      }),
      incrementUnreadForOtherParticipants(chatId, senderId),
    ]);
  }
  return messageId;
};

// Send a media message (image/video/file/audio)
export const sendMediaMessage = async (
  chatId: string,
  senderId: string,
  senderName: string,
  senderAvatar: string | undefined,
  fileUri: string,
  type: 'image' | 'video' | 'file' | 'audio',
  fileName?: string,
  replyTo?: { messageId: string; senderName: string; text?: string; type?: string },
  extraData?: { audioDuration?: number; imageWidth?: number; imageHeight?: number; blurhash?: string; thumbnailUri?: string },
  options?: SendChatMessageOptions
): Promise<string> => {
  const stamp = Date.now();
  const fileExtension = type === 'audio' ? 'm4a' : (fileUri.split('.').pop() || 'jpg');
  const storagePath = `chats/${chatId}/${stamp}.${fileExtension}`;
  const thumbStoragePath = `chats/${chatId}/thumbs/${stamp}.jpg`;

  // Helper: upload a single file URI on native using RN Firebase Storage
  const uploadNative = async (uri: string, path: string): Promise<string> => {
    const { getRnStorage } = require('@/lib/rnFirebase');
    const { ref: rnRef, putFile: rnPutFile, getDownloadURL: rnGetDownloadURL } = require('@react-native-firebase/storage');
    const rnStorage = getRnStorage();
    const storageRef = rnRef(rnStorage, path);
    await rnPutFile(storageRef, uri);
    return rnGetDownloadURL(storageRef);
  };

  // Helper: upload a file URI on web using the web SDK
  const uploadWeb = async (uri: string, path: string): Promise<string> => {
    let blob: Blob;
    try {
      if (uri.startsWith('file://') || uri.startsWith('content://')) {
        const response = await fetch(uri, { method: 'GET', headers: { 'Content-Type': 'application/octet-stream' } });
        if (!response.ok && response.status !== 0) throw new Error(`Failed to load file: ${response.status}`);
        try {
          blob = await response.blob();
        } catch {
          blob = new Blob([await response.arrayBuffer()]);
        }
      } else {
        const response = await fetch(uri);
        if (!response.ok) throw new Error(`Failed to load file: ${response.status}`);
        blob = await response.blob();
      }
    } catch (error) {
      if (__DEV__) console.error('Error converting file to blob:', error);
      throw new Error('Failed to process file for upload');
    }
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, blob);
    return getDownloadURL(storageRef);
  };

  const uploadFile = Platform.OS !== 'web' ? uploadNative : uploadWeb;

  // For videos with a thumbnail URI, upload both in parallel
  let downloadUrl: string;
  let videoThumbnailUrl: string | undefined;

  if (type === 'video' && extraData?.thumbnailUri) {
    [downloadUrl, videoThumbnailUrl] = await Promise.all([
      uploadFile(fileUri, storagePath),
      uploadFile(extraData.thumbnailUri, thumbStoragePath).catch(() => undefined as unknown as string),
    ]);
  } else {
    downloadUrl = await uploadFile(fileUri, storagePath);
  }

  const messageData: any = {
    chatId,
    senderId,
    senderName,
    type,
    readBy: [senderId],
    ...(type === 'image' && {
      imageUrl: downloadUrl,
      ...(extraData?.imageWidth && { imageWidth: extraData.imageWidth }),
      ...(extraData?.imageHeight && { imageHeight: extraData.imageHeight }),
      ...(extraData?.blurhash && { blurhash: extraData.blurhash }),
    }),
    ...(type === 'video' && {
      videoUrl: downloadUrl,
      ...(videoThumbnailUrl && { videoThumbnailUrl }),
    }),
    ...(type === 'audio' && { audioUrl: downloadUrl, audioDuration: extraData?.audioDuration }),
    ...(type === 'file' && { fileUrl: downloadUrl, ...(fileName && { fileName }) }),
  };
  if (senderAvatar !== undefined && senderAvatar !== null) {
    messageData.senderAvatar = senderAvatar;
  }
  if (replyTo) {
    messageData.replyTo = removeUndefined(replyTo);
  }
  const now = new Date().toISOString();
  messageData.status = 'sent';
  messageData.sentAt = now;
  const cleanedMessageData = removeUndefined(messageData);

  const previewText =
    type === 'image' ? '📷 Photo' :
    type === 'video' ? '🎥 Video' :
    type === 'audio' ? '🎤 Audio message' : '📎 File';
  const lastMessage = {
    text: previewText,
    senderId,
    createdAt: now,
  };

  const otherIds = (options?.recipientUserIds ?? []).filter((id) => id && id !== senderId);
  const useParticipantBatch = otherIds.length > 0;

  let messageId: string;
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    if (useParticipantBatch) {
      messageId = await addMessageAndUpdateChatNativeBatch(
        chatId,
        cleanedMessageData,
        lastMessage,
        otherIds
      );
    } else {
      messageId = await addMessageNative(chatId, cleanedMessageData);
      await Promise.all([
        updateChatLastMessageNative(chatId, lastMessage),
        incrementUnreadForOtherParticipants(chatId, senderId),
      ]);
    }
  } else if (useParticipantBatch) {
    messageId = await addWebMessageAndUpdateChatBatch(
      chatId,
      cleanedMessageData,
      lastMessage,
      senderId,
      otherIds
    );
  } else {
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const docRef = await addDoc(messagesRef, {
      ...cleanedMessageData,
      createdAt: serverTimestamp(),
    });
    messageId = docRef.id;
    const chatRef = doc(db, 'chats', chatId);
    await Promise.all([
      updateDoc(chatRef, {
        lastMessage,
        lastMessageAt: serverTimestamp(),
        lastSenderId: senderId,
        updatedAt: serverTimestamp(),
      }),
      incrementUnreadForOtherParticipants(chatId, senderId),
    ]);
  }
  return messageId;
};

/** Increment unread count for all participants except sender. Atomic. Do not increment for sender. */
export async function incrementUnreadForOtherParticipants(chatId: string, senderId: string): Promise<void> {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    await incrementUnreadForOtherParticipantsNative(chatId, senderId);
    return;
  }
  const chatRef = doc(db, 'chats', chatId);
  const chatDoc = await getDoc(chatRef);
  if (!chatDoc.exists()) return;
  const chatData = chatDoc.data();
  const participants: string[] = chatData?.participants || [];
  const others = participants.filter((id: string) => id !== senderId);
  if (others.length === 0) return;
  const updateData: Record<string, any> = { updatedAt: serverTimestamp() };
  others.forEach((uid: string) => {
    updateData[`unreadCount.${uid}`] = increment(1);
  });
  await updateDoc(chatRef, updateData);
}

// Set typing indicator (debounce on caller side)
export const setTypingIndicator = async (chatId: string, userId: string, isTyping: boolean) => {
  try {
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      await setTypingIndicatorNative(chatId, userId, isTyping);
      return;
    }
    const chatRef = doc(db, 'chats', chatId);
    if (isTyping) {
      await updateDoc(chatRef, {
        [`typing.${userId}`]: { at: serverTimestamp() },
      } as any);
    } else {
      await updateDoc(chatRef, {
        [`typing.${userId}`]: deleteField(),
      } as any);
    }
  } catch (e) {
    if (__DEV__) console.warn('setTypingIndicator:', e);
  }
};

// Mark messages as read - resets unread badge when user opens chat
export const markMessagesAsRead = async (chatId: string, userId: string) => {
  // Reset unread count (required for badge) - use native on RN for auth compatibility
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    await markMessagesAsReadNative(chatId, userId);
    return;
  }

  // Reset unread count atomically using field path — does not overwrite other participants' counts.
  const chatRef = doc(db, 'chats', chatId);
  await updateDoc(chatRef, {
    [`unreadCount.${userId}`]: 0,
  });
};

// Mark message as delivered (when recipient device receives it)
export const markMessageAsDelivered = async (
  chatId: string,
  messageId: string
): Promise<void> => {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    await markMessageAsDeliveredNative(chatId, messageId);
    return;
  }
  const messageRef = doc(db, 'chats', chatId, 'messages', messageId);
  const now = new Date().toISOString();
  await updateDoc(messageRef, {
    status: 'delivered',
    deliveredAt: now,
    updatedAt: serverTimestamp(),
  });
};

// Mark message as seen (when recipient views it)
// Pass `hint` to skip redundant Firestore reads when caller already has the data.
export const markMessageAsSeen = async (
  chatId: string,
  messageId: string,
  userId: string,
  hint?: {
    chatType?: 'direct' | 'group';
    messageReadBy?: string[];
    messageSenderId?: string;
    chatParticipants?: string[];
  }
): Promise<void> => {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    await markMessageAsSeenNative(chatId, messageId, userId, hint);
    return;
  }

  const messageRef = doc(db, 'chats', chatId, 'messages', messageId);

  // If caller passed hint data we can skip the reads entirely for direct chats,
  // and skip the message read for group chats (still need participants from chatRef if not provided).
  const knownSenderId = hint?.messageSenderId;
  const knownReadBy = hint?.messageReadBy;
  const knownChatType = hint?.chatType;
  const knownParticipants = hint?.chatParticipants;

  // Don't mark own messages as seen (caller checks this but guard here too)
  if (knownSenderId && knownSenderId === userId) return;

  if (knownChatType === 'direct') {
    if (knownReadBy?.includes(userId)) return;
    const now = new Date().toISOString();
    await updateDoc(messageRef, {
      status: 'seen',
      seenAt: now,
      readBy: [...(knownReadBy ?? []), userId],
      updatedAt: serverTimestamp(),
    });
    return;
  }

  if (knownChatType === 'group' && knownReadBy !== undefined) {
    if (knownReadBy.includes(userId)) return;
    const nextReadBy = [...knownReadBy, userId];
    await updateDoc(messageRef, {
      readBy: nextReadBy,
      updatedAt: serverTimestamp(),
    });
    if (knownParticipants && knownSenderId) {
      const otherParticipants = knownParticipants.filter((p: string) => p !== knownSenderId);
      const allRead = otherParticipants.every((p: string) => nextReadBy.includes(p));
      if (allRead) {
        const now = new Date().toISOString();
        await updateDoc(messageRef, {
          status: 'seen',
          seenAt: now,
          updatedAt: serverTimestamp(),
        });
      }
    }
    return;
  }

  // Fallback: fetch message and chat docs (original behavior for cases without hints)
  const messageDoc = await getDoc(messageRef);
  if (!messageDoc.exists()) return;
  const messageData = messageDoc.data();

  if (messageData.senderId === userId) return;

  const chatRef = doc(db, 'chats', chatId);
  const chatDoc = await getDoc(chatRef);
  const chatData = chatDoc.data();
  const isGroupChat = chatData?.type === 'group';

  if (isGroupChat) {
    const readBy = messageData.readBy || [];
    if (!readBy.includes(userId)) {
      await updateDoc(messageRef, {
        readBy: [...readBy, userId],
        updatedAt: serverTimestamp(),
      });
      const participants = chatData?.participants || [];
      const otherParticipants = participants.filter((p: string) => p !== messageData.senderId);
      const nextRead = [...readBy, userId];
      const allRead = otherParticipants.every((p: string) => nextRead.includes(p));
      if (allRead && messageData.status !== 'seen') {
        const now = new Date().toISOString();
        await updateDoc(messageRef, {
          status: 'seen',
          seenAt: now,
          updatedAt: serverTimestamp(),
        });
      }
    }
  } else {
    const rb: string[] = messageData.readBy || [];
    if (rb.includes(userId)) return;
    if (
      messageData.status === 'delivered' ||
      messageData.status === 'sent' ||
      messageData.status == null
    ) {
      const now = new Date().toISOString();
      await updateDoc(messageRef, {
        status: 'seen',
        seenAt: now,
        readBy: [...rb, userId],
        updatedAt: serverTimestamp(),
      });
    }
  }
};

// Get user data
export const getUser = async (userId: string): Promise<User | null> => {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    const data = await getUserDocNative(userId);
    if (!data) return null;
    const displayName = data.displayName || data.name || '';
    const firstName = data.firstName || (displayName ? displayName.split(' ')[0] || '' : '');
    const lastName = data.lastName || (displayName ? displayName.split(' ').slice(1).join(' ') || '' : '');
    return {
      uid: data.id || userId,
      phoneNumber: data.phoneNumber || data.phone || '',
      firstName,
      lastName,
      username: data.username || '',
      avatar: data.avatar,
      bio: data.bio,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || data.updatedAt || new Date().toISOString(),
      lastActive: data.lastActive?.toDate?.()?.toISOString?.() || data.lastActive,
      isOnline: data.isOnline,
    } as User;
  }
  const userRef = doc(db, 'users', userId);
  const userDoc = await getDoc(userRef);
  if (userDoc.exists()) {
    const data = userDoc.data();
    const displayName = data.displayName || data.name || '';
    const firstName = data.firstName || (displayName ? displayName.split(' ')[0] || '' : '');
    const lastName = data.lastName || (displayName ? displayName.split(' ').slice(1).join(' ') || '' : '');
    return {
      uid: userDoc.id,
      phoneNumber: data.phoneNumber || data.phone || '', // Support legacy 'phone' field
      firstName,
      lastName,
      username: data.username || '',
      avatar: data.avatar,
      bio: data.bio,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt || new Date().toISOString(),
      lastActive: data.lastActive?.toDate?.()?.toISOString() || data.lastActive,
      isOnline: data.isOnline,
    } as User;
  }
  return null;
};

// Create a group chat
export const createGroupChat = async (
  creatorId: string,
  name: string,
  participantIds: string[]
): Promise<string> => {
  const chatsRef = collection(db, 'chats');
  const allParticipants = [creatorId, ...participantIds];
  
  const newChat: Omit<Chat, 'id'> = {
    type: 'group',
    participants: allParticipants,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    unreadCount: allParticipants.reduce((acc, id) => {
      acc[id] = 0;
      return acc;
    }, {} as Record<string, number>),
  };

  const chatDocRef = doc(chatsRef);
  await setDoc(chatDocRef, {
    ...newChat,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(), // Required for chats list ordering (treat as createdAt when no messages)
  });

  return chatDocRef.id;
};

// Toggle reaction on a message
export const toggleReaction = async (
  chatId: string,
  messageId: string,
  userId: string,
  emoji: string
): Promise<void> => {
  const messageRef = doc(db, 'chats', chatId, 'messages', messageId);
  const messageDoc = await getDoc(messageRef);
  
  if (!messageDoc.exists()) {
    throw new Error('Message not found');
  }
  
  const messageData = messageDoc.data();
  const reactions = messageData.reactions || {};
  const currentUsers = reactions[emoji] || [];
  
  // Check if user already reacted with this emoji
  const userIndex = currentUsers.indexOf(userId);
  
  if (userIndex > -1) {
    // Remove reaction
    const updatedUsers = currentUsers.filter((id: string) => id !== userId);
    if (updatedUsers.length === 0) {
      // Remove emoji key if no users left
      const { [emoji]: _, ...rest } = reactions;
      await updateDoc(messageRef, {
        reactions: Object.keys(rest).length > 0 ? rest : {},
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(messageRef, {
        [`reactions.${emoji}`]: updatedUsers,
        updatedAt: serverTimestamp(),
      });
    }
  } else {
    // Remove user's existing reaction to any other emoji (one reaction per user)
    const updatedReactions: Record<string, string[]> = {};
    for (const [reactionEmoji, userIds] of Object.entries(reactions)) {
      if (reactionEmoji !== emoji) {
        updatedReactions[reactionEmoji] = (userIds as string[]).filter((id: string) => id !== userId);
      }
    }
    // Remove empty emoji keys
    const cleanedReactions: Record<string, string[]> = {};
    for (const [reactionEmoji, userIds] of Object.entries(updatedReactions)) {
      if ((userIds as string[]).length > 0) {
        cleanedReactions[reactionEmoji] = userIds as string[];
      }
    }
    
    // Add new reaction
    cleanedReactions[emoji] = [...(currentUsers || []), userId];
    
    await updateDoc(messageRef, {
      reactions: cleanedReactions,
      updatedAt: serverTimestamp(),
    });
  }
};

// Edit a message
export const editMessage = async (
  chatId: string,
  messageId: string,
  newText: string,
  userId: string
): Promise<void> => {
  if (!newText || newText.trim() === '') {
    throw new Error('Message text cannot be empty');
  }

  const messageRef = doc(db, 'chats', chatId, 'messages', messageId);
  const messageDoc = await getDoc(messageRef);

  if (!messageDoc.exists()) {
    throw new Error('Message not found');
  }

  const messageData = messageDoc.data();

  // Security check: Only sender can edit
  if (messageData.senderId !== userId) {
    throw new Error('Only message sender can edit');
  }

  // Don't allow editing deleted messages
  if (messageData.deleted) {
    throw new Error('Cannot edit deleted message');
  }

  // Don't allow editing non-text messages
  if (messageData.type !== 'text') {
    throw new Error('Only text messages can be edited');
  }

  await updateDoc(messageRef, {
    text: newText.trim(),
    edited: true,
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

// Delete a message (for everyone)
export const deleteMessageForEveryone = async (
  chatId: string,
  messageId: string,
  userId: string
): Promise<void> => {
  const messageRef = doc(db, 'chats', chatId, 'messages', messageId);
  const messageDoc = await getDoc(messageRef);

  if (!messageDoc.exists()) {
    throw new Error('Message not found');
  }

  const messageData = messageDoc.data();

  // Security check: Only sender can delete for everyone
  if (messageData.senderId !== userId) {
    throw new Error('Only message sender can delete for everyone');
  }

  // Update message to show as deleted
  await updateDoc(messageRef, {
    deleted: true,
    text: '', // Clear text content
    updatedAt: serverTimestamp(),
  });
};

// Delete a message (for me only)
export const deleteMessageForMe = async (
  chatId: string,
  messageId: string,
  userId: string
): Promise<void> => {
  const messageRef = doc(db, 'chats', chatId, 'messages', messageId);
  const messageDoc = await getDoc(messageRef);

  if (!messageDoc.exists()) {
    throw new Error('Message not found');
  }

  const messageData = messageDoc.data();
  const deletedFor = messageData.deletedFor || [];

  // Add current user to deletedFor array if not already present
  if (!deletedFor.includes(userId)) {
    await updateDoc(messageRef, {
      deletedFor: [...deletedFor, userId],
      updatedAt: serverTimestamp(),
    });
  }
};


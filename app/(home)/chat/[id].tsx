import { stopAllAudioPlayback } from '@/components/AudioMessage';
import ChatHeader from '@/components/ChatHeader';
import EditMessageModal from '@/components/EditMessageModal';
import EmojiPicker from '@/components/EmojiPicker';
import ImageViewer from '@/components/ImageViewer';
import MessageActionMenu from '@/components/MessageActionMenu';
import MessageBubble from '@/components/MessageBubble';
import MessageReactions from '@/components/MessageReactions';
import Screen from '@/components/Screen';
import StickyDateHeader from '@/components/StickyDateHeader';
import SwipeableMessage from '@/components/SwipeableMessage';
import TypingIndicator from '@/components/TypingIndicator';
import VoiceRecorderBar from '@/components/VoiceRecorderBar';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { db } from '@/lib/firebase';
import { hasNativeFirestore, subscribeToChatDocNative, subscribeToUserDocNative } from '@/lib/firestoreNative';
import { deleteMessageForEveryone, deleteMessageForMe, editMessage, markMessageAsDelivered, markMessageAsSeen, markMessagesAsRead, sendMediaMessage, sendMessage, setTypingIndicator, toggleReaction } from '@/lib/services/chatService';
import { Chat, ChatMessage, User } from '@/lib/types/chat';
import { formatDateHeader, shouldShowSender, shouldShowTail } from '@/lib/utils/chatUtils';
import { EMPTY_MESSAGES, useChatStore } from '@/store/chatStore';
import { usePresenceStore } from '@/store/presenceStore';
import Feather from '@expo/vector-icons/Feather';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlashList } from '@shopify/flash-list';
import clsx from 'clsx';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { doc, onSnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AppState, AppStateStatus, Dimensions, InteractionManager, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ChatScreen = () => {
  const { id: chatId, pendingMedia } = useLocalSearchParams<{ id: string; pendingMedia?: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const { colorScheme, isDark } = useTheme();
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';
  
  // State
  const [messageText, setMessageText] = useState('');
  const [chat, setChat] = useState<Chat | null>(null);
  const [sending, setSending] = useState(false);
  const [otherUser, setOtherUser] = useState<User | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [showAttachOptions, setShowAttachOptions] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingLocked, setIsRecordingLocked] = useState(false);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [viewingVideo, setViewingVideo] = useState<string | null>(null);
  const [actionMenuMessage, setActionMenuMessage] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [inputHeight, setInputHeight] = useState(44);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewMessagesButton, setShowNewMessagesButton] = useState(false);
  const [stickyDateLabel, setStickyDateLabel] = useState<string | null>(null);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const [creatingCall, setCreatingCall] = useState(false);
  const lastReadCountRef = useRef(0);
  
  // Refs
  const textInputRef = useRef<TextInput>(null);
  const messageRefs = useRef<Record<string, number>>({});
  const isCleaningUpRef = useRef(false);
  const isStartingRef = useRef(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const lastStartTimestampRef = useRef<number>(0);
  const isMicPressedRef = useRef(false);
  const listRef = useRef<FlashList<ChatMessage>>(null);
  const viewedMessageIdsRef = useRef<Set<string>>(new Set());
  const deliveredMessageIdsRef = useRef<Set<string>>(new Set());
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [inputAreaHeight, setInputAreaHeight] = useState(0);
  const inputAreaRef = useRef<View | null>(null);
  const insets = useSafeAreaInsets();
  const isMountedRef = useRef(true);
  
  // Colors
  const textColor = isDark ? 'text-white' : 'text-black';
  const textSecondaryColor = isDark ? 'text-gray-400' : 'text-gray-600';
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200';
  
  // Load draft when switching chats (per-room persistence)
  useEffect(() => {
    if (!chatId) return;
    AsyncStorage.getItem(`draft_${chatId}`).then((draft) => {
      if (draft && isMountedRef.current) setMessageText(draft);
    });
  }, [chatId]);

  // Stable empty reference when no messages (avoids getSnapshot loop)
  const rawMessages = useChatStore((state) => state.messagesByChat[chatId] ?? EMPTY_MESSAGES);
  
  // Sort NEWEST → OLDEST for inverted list (reverse-scroll: user starts at bottom)
  const messages = useMemo(() => {
    return [...rawMessages].sort((a, b) => {
      const timeA = new Date(a.createdAt || a.sentAt || 0).getTime();
      const timeB = new Date(b.createdAt || b.sentAt || 0).getTime();
      return timeB - timeA; // Newest first → inverted list shows newest at bottom
    });
  }, [rawMessages]);
  
  // ========================================
  // EFFECTS
  // ========================================
  
  // Track if user is at bottom for smart scroll (inverted: offset 0 = bottom)
  const prevMessagesLengthRef = useRef(0);
  const isAtBottomRef = useRef(true);
  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  // Start listener when chat opens - DEFERRED with delay
  useEffect(() => {
    if (!chatId) return;
    
    const timeoutId = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        import('@/lib/services/chatPreloadService').then(({ startChatMessageListener }) => {
          if (isMountedRef.current) {
            startChatMessageListener(chatId, 50);
          }
        });
      });
    }, 300);
    
    return () => {
      isMountedRef.current = false;
      clearTimeout(timeoutId);
      import('@/lib/services/chatPreloadService').then(({ stopChatMessageListener }) => {
        stopChatMessageListener();
      });
    };
  }, [chatId]);
  
  // Load chat from store first (instant), then sync from Firestore
  useEffect(() => {
    if (!chatId) return;

    const cachedChat = useChatStore.getState().chats.find(c => c.id === chatId);
    if (cachedChat) setChat(cachedChat);

    let unsubscribe: (() => void) | null = null;
    const timeoutId = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        if (Platform.OS !== 'web' && hasNativeFirestore) {
          unsubscribe = subscribeToChatDocNative(
            chatId,
            (chatData) => {
              if (chatData && isMountedRef.current) {
                setChat(chatData as Chat);
                useChatStore.getState().updateChat(chatId, chatData as Chat);
                usePresenceStore.getState().setTypingFromChat(
                  chatId,
                  (chatData as any).typing || {},
                  (chatData as any).participantData || {},
                  user?.uid
                );
              }
            },
            (error) => {
              if (__DEV__) console.error('Chat listener error:', error);
            }
          );
        } else {
          const chatRef = doc(db, 'chats', chatId);
          unsubscribe = onSnapshot(chatRef, (chatDoc) => {
            if (chatDoc.exists() && isMountedRef.current) {
              const data = chatDoc.data();
              const chatData = {
                id: chatDoc.id,
                ...data,
                lastMessageAt: data.lastMessageAt?.toDate?.()?.toISOString() || data.lastMessageAt,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
                updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
              } as Chat;
              setChat(chatData);
              useChatStore.getState().updateChat(chatId, chatData);
              usePresenceStore.getState().setTypingFromChat(
                chatId,
                data?.typing || {},
                data?.participantData || {},
                user?.uid
              );
            }
          }, (error) => {
            if (__DEV__) console.error('Chat listener error:', error);
          });
        }
      });
    }, 200);

    return () => {
      clearTimeout(timeoutId);
      if (unsubscribe) unsubscribe();
    };
  }, [chatId]);
  
  // Get other participant ID
  const otherParticipantId = useMemo(() => {
    if (!chat || chat.type === 'group') return null;
    return chat.participants.find(p => p !== user?.uid) || null;
  }, [chat, user?.uid]);
  
  // Load other user's data - DEFERRED
  useEffect(() => {
    if (!otherParticipantId || chat?.type === 'group') {
      setOtherUser(null);
      return;
    }

    const uid = otherParticipantId;
    let unsubscribe: (() => void) | null = null;
    const timeoutId = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        const applyUser = (data: { id: string; lastActive?: any; [k: string]: any } | null) => {
          if (!data || !isMountedRef.current) return;
          const lastActiveTimestamp = typeof data.lastActive === 'number' ? data.lastActive : (data.lastActive ? new Date(data.lastActive).getTime() : undefined);
          const lastActiveDate = typeof data.lastActive === 'string' ? data.lastActive : (data.lastActive ? new Date(data.lastActive).toISOString() : undefined);
          const now = Date.now();
          const fiveMinutesAgo = now - 5 * 60 * 1000;
          const isUserOnline = lastActiveTimestamp != null && lastActiveTimestamp > fiveMinutesAgo;
          usePresenceStore.getState().setOnline(uid, isUserOnline);
          if (lastActiveTimestamp != null) {
            usePresenceStore.getState().setLastActive(uid, lastActiveTimestamp);
          }
          setOtherUser({
            uid: data.id,
            ...data,
            lastActive: lastActiveDate,
          } as User);
        };

        if (Platform.OS !== 'web' && hasNativeFirestore) {
          unsubscribe = subscribeToUserDocNative(uid, applyUser, (error) => {
            if (__DEV__) console.error('User listener error:', error);
          });
        } else {
          const userRef = doc(db, 'users', uid);
          unsubscribe = onSnapshot(userRef, (userDoc) => {
            if (userDoc.exists() && isMountedRef.current) {
              const data = userDoc.data();
              applyUser({
                id: userDoc.id,
                ...data,
                lastActive: data.lastActive?.toDate?.()?.toISOString() || data.lastActive,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
                updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
              });
            }
          }, (error) => {
            if (__DEV__) console.error('User listener error:', error);
          });
        }
      });
    }, 250);

    return () => {
      clearTimeout(timeoutId);
      if (unsubscribe) unsubscribe();
    };
  }, [otherParticipantId, chat?.type]);
  
  // Debounced typing indicator
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!chatId || !user) return;
    if (messageText.trim()) {
      setTypingIndicator(chatId, user.uid, true).catch(() => {});
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
      typingDebounceRef.current = setTimeout(() => {
        setTypingIndicator(chatId, user.uid, false).catch(() => {});
        typingDebounceRef.current = null;
      }, 2000);
    } else {
      setTypingIndicator(chatId, user.uid, false).catch(() => {});
    }
    return () => {
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    };
  }, [messageText, chatId, user?.uid]);

  // Cleanup recording when screen loses focus or app backgrounds
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (recordingRef.current) {
          recordingRef.current.stopAndUnloadAsync().catch(() => {});
          recordingRef.current = null;
          setRecording(null);
          setIsRecording(false);
          setIsRecordingLocked(false);
        }
        stopAllAudioPlayback().catch(() => {});
      };
    }, [])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active' && (isRecording || isRecordingLocked)) {
        if (recordingRef.current) {
          recordingRef.current.stopAndUnloadAsync().catch(() => {});
          recordingRef.current = null;
          setRecording(null);
          setIsRecording(false);
          setIsRecordingLocked(false);
        }
      }
    });
    return () => sub.remove();
  }, [isRecording, isRecordingLocked]);
  
  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);
  
  // Mark messages as read - DEFERRED
  useEffect(() => {
    if (user && chatId && messages.length > 0) {
      InteractionManager.runAfterInteractions(() => {
        markMessagesAsRead(chatId, user.uid).catch(() => {});
      });
    }
  }, [chatId, user?.uid, messages.length]);
  
  // Memoize incoming messages
  const incomingMessages = useMemo(() => {
    if (!user) return [];
    return messages.filter(m => m.senderId !== user.uid && m.status === 'sent');
  }, [messages, user?.uid]);
  
  // Listen for real-time status updates on incoming messages
  useEffect(() => {
    if (!chatId || !user || incomingMessages.length === 0) return;
    
    InteractionManager.runAfterInteractions(() => {
      incomingMessages.forEach(async (message) => {
        if (!deliveredMessageIdsRef.current.has(message.id)) {
          deliveredMessageIdsRef.current.add(message.id);
          try {
            await markMessageAsDelivered(chatId, message.id);
          } catch (error) {
            deliveredMessageIdsRef.current.delete(message.id);
          }
        }
      });
    });
  }, [incomingMessages, chatId, user?.uid]);
  
  
  // Handle keyboard show/hide (only track height, no auto-scroll)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    
    const showSubscription = Keyboard.addListener(showEvent, (e) => {
      const height = e.endCoordinates.height;
      setKeyboardHeight(height);
    });
    
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);
  
  // Handle pending media
  useEffect(() => {
    const handlePendingMedia = async () => {
      if (pendingMedia === 'true' && user && chatId) {
        try {
          const stored = await AsyncStorage.getItem('pendingMediaForChannel');
          if (stored) {
            const { media: pendingMediaData } = JSON.parse(stored);
            if (pendingMediaData) {
              const mediaType = pendingMediaData.type?.includes('video') ? 'video' :
                pendingMediaData.type?.includes('image') ? 'image' : 'file';
              await sendMediaMessage(
                chatId,
                user.uid,
                user?.displayName || user?.phoneNumber || 'User',
                user?.photoURL || undefined,
                pendingMediaData.uri,
                mediaType
              );
              await AsyncStorage.removeItem('pendingMediaForChannel');
            }
          }
        } catch (error) {
          if (__DEV__) console.error('Error sending pending media:', error);
        }
      }
    };
    
    handlePendingMedia();
  }, [pendingMedia, chatId, user]);
  
  // ========================================
  // HANDLERS
  // ========================================
  
  const handleSendMessage = async () => {
    if (!chatId || !messageText.trim() || !user) return;
    
    const text = messageText.trim();
    const tempId = `pending-${Date.now()}`;
    const now = new Date().toISOString();
    
    // Optimistic UI: show message immediately with clock icon
    const optimisticMessage: ChatMessage = {
      id: tempId,
      chatId,
      senderId: user.uid,
      senderName: user?.displayName || user?.phoneNumber || 'User',
      senderAvatar: user?.photoURL,
      text,
      type: 'text',
      createdAt: now,
      sentAt: now,
      readBy: [user.uid],
      status: 'pending',
      replyTo: replyingTo ? { messageId: replyingTo.id, senderName: replyingTo.senderName, text: replyingTo.text, type: replyingTo.type } : undefined,
    };
    useChatStore.getState().addMessage(chatId, optimisticMessage);
    
    setMessageText('');
    if (chatId) AsyncStorage.removeItem(`draft_${chatId}`).catch(() => {});
    setReplyingTo(null);
    setShowEmojiPicker(false);
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    setSending(true);
    try {
      const messageId = await sendMessage(
        chatId,
        user.uid,
        user?.displayName || user?.phoneNumber || 'User',
        user?.photoURL || undefined,
        text,
        replyingTo ? {
          messageId: replyingTo.id,
          senderName: replyingTo.senderName,
          text: replyingTo.text,
          type: replyingTo.type,
        } : undefined
      );
      useChatStore.getState().updateMessage(chatId, tempId, { id: messageId, status: 'sent' });
      textInputRef.current?.focus();
    } catch (error) {
      if (__DEV__) console.error('Error sending message:', error);
      useChatStore.getState().updateMessage(chatId, tempId, { status: 'failed' });
      Alert.alert(t('common.error'), t('messages.failedToSend'));
    } finally {
      setSending(false);
    }
  };
  
  const handleEmojiSelect = (emoji: string) => {
    setMessageText(prev => prev + emoji);
    textInputRef.current?.focus();
  };
  
  const handleSwipeToReply = useCallback((message: ChatMessage) => {
    setReplyingTo(message);
  }, []);
  
  const handleLongPress = useCallback((message: ChatMessage) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActionMenuMessage(message);
  }, []);
  
  const handleReactionSelect = useCallback(async (messageId: string, emoji: string) => {
    if (!user || !chatId) return;
    try {
      await toggleReaction(chatId, messageId, user.uid, emoji);
    } catch (error) {
      if (__DEV__) console.error('Error toggling reaction:', error);
    }
  }, [user, chatId]);

  const handleRetryMessage = useCallback(async (message: ChatMessage) => {
    if (!user || !chatId || !message.text || message.senderId !== user.uid) return;
    setSending(true);
    try {
      const messageId = await sendMessage(
        chatId,
        user.uid,
        user?.displayName || user?.phoneNumber || 'User',
        user?.photoURL || undefined,
        message.text,
        message.replyTo ? {
          messageId: message.replyTo.messageId,
          senderName: message.replyTo.senderName,
          text: message.replyTo.text,
          type: message.replyTo.type,
        } : undefined
      );
      useChatStore.getState().updateMessage(chatId, message.id, { id: messageId, status: 'sent' });
    } catch (error) {
      if (__DEV__) console.error('Retry send error:', error);
      Alert.alert(t('common.error'), t('messages.failedToSend'));
    } finally {
      setSending(false);
    }
  }, [user, chatId, t]);
  
  const getRecordingDuration = useCallback(() => {
    if (!recordingRef.current) return 0;
    return (Date.now() - lastStartTimestampRef.current) / 1000;
  }, []);

  const handleReplyPress = useCallback((messageId: string) => {
    const index = messages.findIndex(msg => msg.id === messageId);
    if (index !== -1 && listRef.current) {
      listRef.current.scrollToIndex({ index, animated: true });
    }
  }, [messages]);
  
  // ========================================
  // AUDIO RECORDING
  // ========================================
  
  const cleanupRecording = async () => {
    try {
      const rec = recordingRef.current;
      setRecording(null);
      recordingRef.current = null;
      setIsRecording(false);
      
      if (rec) {
        try {
          await rec.stopAndUnloadAsync().catch(() => {});
        } catch (e) {
          try {
            await (rec as any).unloadAsync().catch(() => {});
          } catch {}
        }
      }
      
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      }).catch(() => {});
    } catch (e) {
      if (__DEV__) console.error('Cleanup recording error:', e);
    }
  };
  
  const startRecording = async (): Promise<boolean> => {
    if (isRecording || isStartingRef.current || isCleaningUpRef.current) return false;
    
    isMicPressedRef.current = true;
    isStartingRef.current = true;
    
    try {
      const perm = await Audio.getPermissionsAsync();
      if (perm.status === 'denied') {
        Alert.alert(
          t('common.permissionRequired'),
          'Microphone access is required to send voice notes. Please enable it in Settings.',
          [{ text: t('common.ok') }]
        );
        isStartingRef.current = false;
        return false;
      }
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          t('common.permissionRequired'),
          'Microphone access is required to send voice notes.',
          [{ text: t('common.ok') }]
        );
        isStartingRef.current = false;
        return false;
      }
      
      await cleanupRecording();
      await new Promise(resolve => setTimeout(resolve, 150));
      
      if (!isMicPressedRef.current) {
        isStartingRef.current = false;
        await cleanupRecording();
        return false;
      }
      
      // Set audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
      
      if (!isMicPressedRef.current) {
        isStartingRef.current = false;
        await cleanupRecording();
        return false;
      }
      
      // Start recording
      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      
      if (!isMicPressedRef.current) {
        await newRecording.stopAndUnloadAsync().catch(() => {});
        isStartingRef.current = false;
        return false;
      }
      
      recordingRef.current = newRecording;
      setRecording(newRecording);
      setIsRecording(true);
      setIsRecordingLocked(false);
      lastStartTimestampRef.current = Date.now();
      return true;
    } catch (error: any) {
      if (__DEV__) console.error('Failed to start recording:', error);
      
      if (error.message?.includes('Only one Recording')) {
        await cleanupRecording();
        await new Promise(resolve => setTimeout(resolve, 500));
        
        try {
          if (!isMicPressedRef.current) {
            isStartingRef.current = false;
            return;
          }
          
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
          });
          
          const { recording: retryRec } = await Audio.Recording.createAsync(
            Audio.RecordingOptionsPresets.HIGH_QUALITY
          );
          
          if (!isMicPressedRef.current) {
            await retryRec.stopAndUnloadAsync().catch(() => {});
            isStartingRef.current = false;
            return;
          }
          
          recordingRef.current = retryRec;
          setRecording(retryRec);
          setIsRecording(true);
          lastStartTimestampRef.current = Date.now();
        } catch (retryErr) {
          if (__DEV__) console.error('Emergency reset failed:', retryErr);
          Alert.alert(t('common.error'), t('messages.microphoneUnavailable'));
        }
      } else {
        Alert.alert(t('common.error'), t('messages.failedToRecord'));
      }
      return false;
    } finally {
      isStartingRef.current = false;
    }
  };
  
  const stopRecording = async (cancel: boolean = false) => {
    isMicPressedRef.current = false;
    setIsRecordingLocked(false);
    
    // Wait for startRecording to finish if in progress
    let waitAttempts = 0;
    while (isStartingRef.current && waitAttempts < 15) {
      await new Promise(resolve => setTimeout(resolve, 150));
      waitAttempts++;
    }
    
    // ⚠️ CRITICAL FIX: Capture reference BEFORE async operations
    const currentRecording = recordingRef.current;
    
    if (!currentRecording) {
      setIsRecording(false);
      return;
    }
    
    if (isCleaningUpRef.current) return;
    
    // Guard against stopping too fast
    const timeSinceStart = Date.now() - lastStartTimestampRef.current;
    if (timeSinceStart < 300) {
      await new Promise(resolve => setTimeout(resolve, 300 - timeSinceStart));
    }
    
    isCleaningUpRef.current = true;
    
    try {
      setIsRecording(false);
      
      // Get status and duration
      let duration = 0;
      let uri = null;
      
      try {
        const status = await currentRecording.getStatusAsync();
        if (status) {
          duration = (status.durationMillis || 0) / 1000;
          uri = currentRecording.getURI();
        }
      } catch (e: any) {
        if (!e.message?.includes('Recorder does not exist')) {
          if (__DEV__) console.error('Get status error:', e);
        }
      }
      
      // Stop and unload
      try {
        await currentRecording.stopAndUnloadAsync().catch(() => {});
      } catch (e: any) {
        if (!e.message?.includes('Recorder does not exist')) {
          if (__DEV__) console.error('Stop recording error:', e);
        }
      }
      
      setRecording(null);
      recordingRef.current = null;
      
      if (!cancel && uri && user && duration >= 0.5) {
        setSending(true);
        try {
          await sendMediaMessage(
            chatId,
            user.uid,
            user?.displayName || user?.phoneNumber || 'User',
            user?.photoURL || undefined,
            uri,
            'audio',
            undefined,
            replyingTo ? {
              messageId: replyingTo.id,
              senderName: replyingTo.senderName,
              text: replyingTo.text,
              type: replyingTo.type,
            } : undefined,
            { audioDuration: duration }
          );
          setReplyingTo(null);
        } catch (err) {
          if (__DEV__) console.error('Error sending audio:', err);
          Alert.alert(t('common.error'), t('messages.failedToSendAudio'));
        } finally {
          if (isMountedRef.current) setSending(false);
        }
      }
    } catch (error: any) {
      if (!error.message?.includes('Recorder does not exist')) {
        if (__DEV__) console.error('Failed to stop recording:', error);
      }
      await cleanupRecording();
    } finally {
      isCleaningUpRef.current = false;
    }
  };
  
  // ========================================
  // MEDIA PICKERS
  // ========================================
  
  const handlePickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('common.permissionRequired'), t('messages.permissionCameraRoll'));
        return;
      }
      
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });
      
      if (!result.canceled && result.assets[0] && user) {
        setSending(true);
        try {
          await sendMediaMessage(
            chatId,
            user.uid,
            user?.displayName || user?.phoneNumber || 'User',
            user?.photoURL || undefined,
            result.assets[0].uri,
            'image',
            undefined,
            replyingTo ? {
              messageId: replyingTo.id,
              senderName: replyingTo.senderName,
              text: replyingTo.text,
              type: replyingTo.type,
            } : undefined
          );
          setReplyingTo(null);
        } catch (error) {
          if (__DEV__) console.error('Error sending image:', error);
          Alert.alert(t('common.error'), t('messages.failedToSendImage'));
        } finally {
          if (isMountedRef.current) {
            setSending(false);
          }
          setShowAttachOptions(false);
        }
      }
    } catch (error) {
      if (__DEV__) console.error('Error picking image:', error);
    }
  };
  
  const handlePickVideo = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('common.permissionRequired'), t('messages.permissionCameraRoll'));
        return;
      }
      
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: true,
        quality: 0.8,
        videoMaxDuration: 60,
      });
      
      if (!result.canceled && result.assets[0] && user) {
        setSending(true);
        try {
          await sendMediaMessage(
            chatId,
            user.uid,
            user?.displayName || user?.phoneNumber || 'User',
            user?.photoURL || undefined,
            result.assets[0].uri,
            'video',
            undefined,
            replyingTo ? {
              messageId: replyingTo.id,
              senderName: replyingTo.senderName,
              text: replyingTo.text,
              type: replyingTo.type,
            } : undefined
          );
          setReplyingTo(null);
        } catch (error) {
          if (__DEV__) console.error('Error sending video:', error);
          Alert.alert(t('common.error'), t('messages.failedToSendVideo'));
        } finally {
          if (isMountedRef.current) {
            setSending(false);
          }
          setShowAttachOptions(false);
        }
      }
    } catch (error) {
      if (__DEV__) console.error('Error picking video:', error);
    }
  };
  
  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('common.permissionRequired'), t('messages.permissionCamera'));
        return;
      }
      
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });
      
      if (!result.canceled && result.assets[0] && user) {
        setSending(true);
        try {
          await sendMediaMessage(
            chatId,
            user.uid,
            user?.displayName || user?.phoneNumber || 'User',
            user?.photoURL || undefined,
            result.assets[0].uri,
            'image',
            undefined,
            replyingTo ? {
              messageId: replyingTo.id,
              senderName: replyingTo.senderName,
              text: replyingTo.text,
              type: replyingTo.type,
            } : undefined
          );
          setReplyingTo(null);
        } catch (error) {
          if (__DEV__) console.error('Error sending photo:', error);
          Alert.alert(t('common.error'), t('messages.failedToSendPhoto'));
        } finally {
          if (isMountedRef.current) {
            setSending(false);
          }
          setShowAttachOptions(false);
        }
      }
    } catch (error) {
      if (__DEV__) console.error('Error taking photo:', error);
    }
  };
  
  // ========================================
  // MEMOIZED VALUES
  // ========================================
  
  const typingUsers = usePresenceStore((s) => s.typingUsers);
  const typingNames = useMemo(() => {
    return usePresenceStore.getState().getTypingNames(chatId, user?.uid);
  }, [typingUsers, chatId, user?.uid]);

  const displayName = useMemo(() => {
    if (!chat) return 'Chat';
    if (chat.type === 'group') return chat.name || 'Group Chat';
    if (otherUser) {
      return `${otherUser.firstName} ${otherUser.lastName}`.trim() || otherUser.username || 'Unknown';
    }
    const otherParticipant = chat.participants.find(p => p !== user?.uid);
    return chat.participantData?.[otherParticipant || '']?.name || 'Unknown';
  }, [chat, otherUser, user?.uid]);
  
  const displayAvatar = useMemo(() => {
    if (!chat) return undefined;
    if (chat.type === 'group') return chat.avatar;
    return otherUser?.avatar || chat.participantData?.[otherParticipantId || '']?.avatar;
  }, [chat, otherUser, otherParticipantId]);
  
  const isOnlineStatus = useMemo(() => {
    if (!otherUser?.lastActive || chat?.type === 'group') return false;
    const presenceStore = usePresenceStore.getState();
    if (otherParticipantId && presenceStore.onlineUsers[otherParticipantId] !== undefined) {
      return presenceStore.onlineUsers[otherParticipantId];
    }
    const lastActive = otherUser.lastActive ? new Date(otherUser.lastActive).getTime() : 0;
    const now = Date.now();
    const diffMs = now - lastActive;
    return diffMs < 5 * 60 * 1000;
  }, [otherUser?.lastActive, chat?.type, otherParticipantId]);
  
  const lastSeenText = useMemo(() => {
    if (!otherUser?.lastActive || chat?.type === 'group') return '';
    if (isOnlineStatus) return 'Online';
    
    const lastActive = otherUser.lastActive ? new Date(otherUser.lastActive).getTime() : 0;
    const now = Date.now();
    const diffMs = now - lastActive;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Last seen just now';
    if (diffMins < 60) return `Last seen ${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `Last seen ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `Last seen ${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    const date = new Date(lastActive);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[date.getMonth()];
    const day = date.getDate();
    return `Last seen ${month} ${day}`;
  }, [otherUser?.lastActive, chat?.type, isOnlineStatus]);
  
  // ========================================
  // SCROLL & VIEWABILITY
  // ========================================
  
  const handleViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: Array<{ item: ChatMessage }> }) => {
    if (!user || !chatId) return;
    
    viewableItems.forEach(({ item }) => {
      const message = item as ChatMessage;
      
      // Mark as delivered
      if (message.senderId !== user.uid &&
          message.status !== 'delivered' &&
          message.status !== 'seen' &&
          !deliveredMessageIdsRef.current.has(message.id)) {
        deliveredMessageIdsRef.current.add(message.id);
        markMessageAsDelivered(chatId, message.id).catch(() => {});
      }
      
      // Mark as seen
      if (message.senderId !== user.uid &&
          message.status !== 'seen' &&
          !viewedMessageIdsRef.current.has(message.id)) {
        viewedMessageIdsRef.current.add(message.id);
        markMessageAsSeen(chatId, message.id, user.uid).catch(() => {});
      }
    });
  }, [user?.uid, chatId]);
  
  const handleImagePress = useCallback((imageUrl: string) => {
    setViewingImage(imageUrl);
  }, []);
  
  // Memoize keyExtractor for FlatList stability
  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);
  
  // Estimate item height for getItemLayout (average message height ~80px)
  const getItemLayout = useCallback((data: ArrayLike<ChatMessage> | null | undefined, index: number) => {
    return {
      length: 80,
      offset: 80 * index,
      index,
    };
  }, []);
  
  // Memoize contentContainerStyle - padding for inverted list (space at top when scrolled)
  const contentContainerStyleMemo = useMemo(() => ({
    paddingBottom: 12,
  }), []);

  // Inverted: scroll to offset 0 = bottom (newest). Auto-scroll when at bottom + new message.
  const onContentSizeChange = useCallback(() => {
    if (messages.length === 0) return;
    const prevLen = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;
    const atBottom = isAtBottomRef.current;
    if (prevLen === 0 || (atBottom && messages.length > prevLen)) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: prevLen > 0 });
      });
    }
  }, [messages.length]);
  
  // Memoize viewabilityConfig
  const viewabilityConfigMemo = useMemo(() => ({
    itemVisiblePercentThreshold: 50,
  }), []);
  
  // Optimize scroll handler - FAB when scrolled >300px, sticky date, new message count
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleScroll = useCallback((event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent ?? {};
    const contentOffsetY = contentOffset?.y ?? 0;
    const messagesLength = messages.length;

    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

    scrollTimeoutRef.current = setTimeout(() => {
      // Inverted: offset 0 = bottom. FAB when scrolled up >300px
      const atBottom = contentOffsetY < 100;
      const scrolledUp = contentOffsetY > 300;
      setIsAtBottom(atBottom);
      setShowNewMessagesButton(scrolledUp && messagesLength > 0);

      // Sticky date: derive from scroll position (inverted: higher offset = older)
      if (messagesLength > 0 && scrolledUp) {
        const visibleStart = Math.floor((contentOffsetY / 80) * 0.5);
        const idx = Math.min(visibleStart, messages.length - 1);
        const msg = messages[idx];
        if (msg?.createdAt) setStickyDateLabel(formatDateHeader(msg.createdAt));
      } else {
        setStickyDateLabel(null);
      }
    }, 50);
  }, [messages]);

  // Count new messages when scrolled up (reset when at bottom)
  useEffect(() => {
    if (isAtBottom) {
      lastReadCountRef.current = messages.length;
      setNewMessagesCount(0);
    } else if (messages.length > lastReadCountRef.current) {
      setNewMessagesCount(messages.length - lastReadCountRef.current);
    }
  }, [messages.length, isAtBottom]);
  
  // Date header visibility (show when new day)
  const shouldShowDateHeader = useMemo(() => {
    const cache = new Map<number, boolean>();
    return (currentIndex: number) => {
      if (cache.has(currentIndex)) return cache.get(currentIndex)!;
      if (currentIndex === 0) {
        cache.set(currentIndex, true);
        return true;
      }
      const prev = messages[currentIndex - 1];
      const curr = messages[currentIndex];
      if (!prev || !curr) {
        cache.set(currentIndex, true);
        return true;
      }
      const prevDate = new Date(prev.createdAt || 0).toDateString();
      const currDate = new Date(curr.createdAt || 0).toDateString();
      const result = prevDate !== currDate;
      cache.set(currentIndex, result);
      return result;
    };
  }, [messages]);
  
  const isGroupChat = chat?.type === 'group';

  // Stable renderItem
  const renderMessage = useCallback(({ item, index }: { item: ChatMessage; index: number }) => {
    const isMyMessage = item.senderId === user?.uid;
    messageRefs.current[item.id] = index;
    const showTail = shouldShowTail(messages, index);
    const showSenderName = shouldShowSender(messages, index);
    const showAvatar = isGroupChat && showSenderName && !isMyMessage;
    const showDateHeader = shouldShowDateHeader(index);
    
    // Filter: Don't render if deleted for current user
    if (item.deletedFor && user && item.deletedFor.includes(user.uid)) {
      return null;
    }
    
    // Render call log message (system message) - not swipeable
    if (item.type === 'call') {
      return (
        <View className="items-center my-2">
          <View className={clsx(
            'px-4 py-2 rounded-full',
            isDark ? 'bg-gray-800' : 'bg-gray-100'
          )}>
            <Text className={clsx(
              'text-xs',
              isDark ? 'text-gray-300' : 'text-gray-600'
            )}>
              {item.text}
            </Text>
          </View>
        </View>
      );
    }
    
    return (
      <View>
        {/* Date Header */}
        {showDateHeader && (
          <View className="items-center my-4">
            <View className={clsx(
              'px-3 py-1 rounded-full',
              isDark ? 'bg-gray-800' : 'bg-gray-100'
            )}>
              <Text className={clsx(
                'text-xs font-medium',
                isDark ? 'text-gray-300' : 'text-gray-600'
              )}>
                {formatDateHeader(item.createdAt)}
              </Text>
            </View>
          </View>
        )}
        
        <SwipeableMessage
          message={item}
          isMyMessage={isMyMessage}
          onSwipeToReply={handleSwipeToReply}
          onLongPress={handleLongPress}
          onReplyPress={handleReplyPress}
        >
          <MessageBubble
            message={item}
            isMyMessage={isMyMessage}
            textColor={textColor}
            textSecondaryColor={textSecondaryColor}
            colorScheme={colorScheme}
            isDark={isDark}
            isGroupChat={!!isGroupChat}
            onReplyPress={handleReplyPress}
            onImagePress={handleImagePress}
            onLongPress={handleLongPress}
            onRetry={handleRetryMessage}
            showTail={showTail}
            showSenderName={showSenderName}
            showAvatar={showAvatar}
          />
          {user && item && (
            <MessageReactions
              message={item}
              currentUserId={user.uid}
              onReactionPress={handleReactionSelect}
            />
          )}
        </SwipeableMessage>
      </View>
    );
  }, [
    user?.uid, isDark, colorScheme, textColor, textSecondaryColor, isGroupChat,
    handleReplyPress, handleSwipeToReply, handleLongPress, handleRetryMessage,
    handleReactionSelect, handleImagePress, shouldShowDateHeader, messages
  ]);
  
  // ========================================
  // RENDER
  // ========================================
  
  return (
    <Screen viewClassName="flex-1">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={insets.top}
      >
      <ChatHeader
        chat={chat}
        otherUser={otherUser}
        isOnline={isOnlineStatus}
        lastSeenText={lastSeenText}
        displayName={displayName}
        displayAvatar={displayAvatar}
        textColor={textColor}
        textSecondaryColor={textSecondaryColor}
        borderColor={borderColor}
        iconColor={iconColor}
        isDark={isDark}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/chats'))}
        onVideoCall={async () => {
          if (!chat || !user || chat.type === 'group' || creatingCall) return;
          const otherParticipantId = chat.participants.find(p => p !== user.uid);
          if (!otherParticipantId) return;
          setCreatingCall(true);
          try {
            const { createCall } = await import('@/lib/services/callService');
            const callId = await createCall(user.uid, otherParticipantId, 'video', chatId);
            router.push(`/(home)/call/${callId}`);
          } catch (error) {
            if (__DEV__) console.error('Error starting video call:', error);
            Alert.alert(t('common.error'), t('messages.failedToStartVideoCall'));
          } finally {
            setCreatingCall(false);
          }
        }}
        onAudioCall={async () => {
          if (!chat || !user || chat.type === 'group' || creatingCall) return;
          const otherParticipantId = chat.participants.find(p => p !== user.uid);
          if (!otherParticipantId) return;
          setCreatingCall(true);
          try {
            const { createCall } = await import('@/lib/services/callService');
            const callId = await createCall(user.uid, otherParticipantId, 'audio', chatId);
            router.push(`/(home)/call/${callId}`);
          } catch (error) {
            if (__DEV__) console.error('Error starting audio call:', error);
            Alert.alert(t('common.error'), t('messages.failedToStartAudioCall'));
          } finally {
            setCreatingCall(false);
          }
        }}
        creatingCall={creatingCall}
      />
      
      <View style={{ flex: 1 }}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 16,
            paddingVertical: 8,
          }}
        >
          {messages.length === 0 ? (
            <View className="flex-1 items-center justify-center px-8">
              <View className={clsx(
                'w-20 h-20 rounded-full items-center justify-center mb-4',
                isDark ? 'bg-gray-800' : 'bg-gray-100'
              )}>
                <Feather name="message-circle" size={40} color={isDark ? '#9ca3af' : '#6b7280'} />
              </View>
              <Text className={clsx('text-lg font-semibold mb-2', textColor)}>
                No messages yet
              </Text>
              <Text className={clsx('text-sm text-center', textSecondaryColor)}>
                Start the conversation by sending a message
              </Text>
            </View>
          ) : (
            <FlashList
              ref={listRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={keyExtractor}
              estimatedItemSize={80}
              inverted={true}
              ListHeaderComponent={typingNames.length > 0 ? (
                <TypingIndicator name={typingNames[0]} visible={true} isDark={isDark} />
              ) : null}
              contentContainerStyle={contentContainerStyleMemo}
              onContentSizeChange={onContentSizeChange}
              onScroll={handleScroll}
              scrollEventThrottle={32}
              onViewableItemsChanged={handleViewableItemsChanged}
              viewabilityConfig={viewabilityConfigMemo}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            />
          )}
          
          {/* Sticky date header - shows when scrolled up */}
          {stickyDateLabel && (
            <View className="absolute top-0 left-0 right-0 z-10 pt-2">
              <StickyDateHeader label={stickyDateLabel} isDark={!!isDark} />
            </View>
          )}

          {/* Scroll to bottom FAB with new message badge */}
          {showNewMessagesButton && (
            <Pressable
              onPress={() => {
                setIsAtBottom(true);
                setShowNewMessagesButton(false);
                setNewMessagesCount(0);
                lastReadCountRef.current = messages.length;
                listRef.current?.scrollToOffset({ offset: 0, animated: true });
              }}
              className="absolute top-4 left-1/2 bg-[#337E84] rounded-full px-4 py-2 flex-row items-center gap-2 shadow-lg z-20"
              style={{ transform: [{ translateX: -50 }] }}
              accessibilityLabel={newMessagesCount > 0 ? `${newMessagesCount} new messages` : 'Scroll to bottom'}
            >
              <Feather name="arrow-down" size={16} color="white" />
              <Text className="text-white text-sm font-medium">
                {newMessagesCount > 0 ? `${newMessagesCount} ${t('messages.newMessages')}` : t('messages.newMessages')}
              </Text>
              {newMessagesCount > 0 && (
                <View className="bg-white rounded-full min-w-[20px] h-5 items-center justify-center px-1.5">
                  <Text className="text-[#337E84] text-xs font-bold">{newMessagesCount}</Text>
                </View>
              )}
            </Pressable>
          )}
        </View>
        
        {/* Message input - fixed at bottom, above keyboard */}
        <View
          ref={inputAreaRef}
          onLayout={(e) => {
            const { height } = e.nativeEvent.layout;
            setInputAreaHeight(height);
          }}
          style={{
            backgroundColor: isDark ? '#111827' : '#ffffff',
            borderTopWidth: 1,
            borderTopColor: isDark ? '#374151' : '#e5e7eb',
            paddingBottom: Platform.OS === 'ios' ? insets.bottom : 8,
            paddingTop: 4,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 5,
          }}
        >
          {replyingTo && (
            <View className={clsx(
              'px-4 py-2 border-t',
              borderColor,
              isDark ? 'bg-gray-800' : 'bg-gray-50'
            )}>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center flex-1 gap-2">
                  <View className={clsx('w-0.5 h-8', 'bg-[#337E84]')} />
                  <View className="flex-1">
                    <Text className={clsx('text-xs font-semibold', textColor)}>
                      {t('messages.replyingTo')} {replyingTo.senderId === user?.uid ? t('messages.you') : replyingTo.senderName}
                    </Text>
                    <Text className={clsx('text-xs mt-0.5', textSecondaryColor)} numberOfLines={1}>
                      {replyingTo.text || (replyingTo.type === 'image' ? `📷 ${t('messages.photo')}` : replyingTo.type === 'video' ? `🎥 ${t('messages.video')}` : t('messages.media'))}
                    </Text>
                  </View>
                </View>
                <Pressable onPress={() => setReplyingTo(null)}>
                  <Feather name="x" size={20} color={iconColor} />
                </Pressable>
              </View>
            </View>
          )}
          
          {showAttachOptions && (
            <>
              <Pressable
                className="absolute inset-0 bg-black/20"
                onPress={() => setShowAttachOptions(false)}
                style={{ bottom: keyboardHeight > 0 ? keyboardHeight + 60 : 60 }}
              />
              <View
                className={clsx(
                  'absolute left-4 right-4 rounded-2xl p-4 shadow-lg z-10',
                  isDark ? 'bg-gray-800' : 'bg-white'
                )}
                style={{ bottom: keyboardHeight > 0 ? keyboardHeight + 60 : 60 }}
              >
                <View className="flex-row gap-4">
                  <Pressable
                    onPress={handleTakePhoto}
                    className="items-center gap-2 flex-1"
                  >
                    <View className={clsx('w-14 h-14 rounded-full items-center justify-center', isDark ? 'bg-blue-900/30' : 'bg-blue-100')}>
                      <Feather name="camera" size={24} color="#337E84" />
                    </View>
                    <Text className={clsx('text-xs', textColor)}>{t('stories.camera')}</Text>
                  </Pressable>
                  <Pressable
                    onPress={handlePickImage}
                    className="items-center gap-2 flex-1"
                  >
                    <View className={clsx('w-14 h-14 rounded-full items-center justify-center', isDark ? 'bg-green-900/30' : 'bg-green-100')}>
                      <Feather name="image" size={24} color="#337E84" />
                    </View>
                    <Text className={clsx('text-xs', textColor)}>{t('messages.photo')}</Text>
                  </Pressable>
                  <Pressable
                    onPress={handlePickVideo}
                    className="items-center gap-2 flex-1"
                  >
                    <View className={clsx('w-14 h-14 rounded-full items-center justify-center', isDark ? 'bg-purple-900/30' : 'bg-purple-100')}>
                      <Feather name="video" size={24} color="#337E84" />
                    </View>
                    <Text className={clsx('text-xs', textColor)}>{t('messages.video')}</Text>
                  </Pressable>
                </View>
              </View>
            </>
          )}
          
          <View className={clsx(
            'flex-row items-end gap-2 px-4 py-2',
            isDark ? 'bg-gray-900' : 'bg-white'
          )}>
            <Pressable
              onPress={() => {
                setShowEmojiPicker(!showEmojiPicker);
                setShowAttachOptions(false);
              }}
              className="p-2"
            >
              <Feather name="smile" size={22} color={iconColor} />
            </Pressable>
            
            <Pressable
              onPress={() => {
                setShowAttachOptions(!showAttachOptions);
                setShowEmojiPicker(false);
              }}
              className="p-2"
            >
              <Feather name="paperclip" size={22} color={iconColor} />
            </Pressable>
            
            <View className="flex-1 flex-col gap-2">
              {/* Recording bar - separate row above input when recording */}
              {(isRecording || isRecordingLocked) && (
                <VoiceRecorderBar
                  isDark={!!isDark}
                  onStartRecording={startRecording}
                  onStopRecording={stopRecording}
                  getRecordingDuration={getRecordingDuration}
                  isRecording={isRecording}
                  isLocked={isRecordingLocked}
                  onLockChange={setIsRecordingLocked}
                  isReady={false}
                />
              )}
              <View className="flex-row items-end gap-2 flex-1">
                <TextInput
                  ref={textInputRef}
                  className={clsx(
                    'flex-1 rounded-2xl px-4 py-3',
                    isDark ? 'bg-gray-800 text-white' : 'bg-gray-100 text-black'
                  )}
                  placeholder={t('messages.typeMessage')}
                  placeholderTextColor={colorScheme === 'dark' ? '#9ca3af' : '#6b7280'}
                  value={messageText}
                  onChangeText={(text) => {
                    setMessageText(text);
                    if (chatId) {
                      AsyncStorage.setItem(`draft_${chatId}`, text).catch(() => {});
                    }
                  }}
                  multiline
                  maxLength={1000}
                  onSubmitEditing={handleSendMessage}
                  style={{
                    maxHeight: 132,
                    minHeight: 44,
                    height: Math.min(Math.max(inputHeight, 44), 132),
                    fontSize: 16,
                    lineHeight: 22,
                  }}
                  onContentSizeChange={(e) => {
                    const newHeight = Math.min(Math.max(e.nativeEvent.contentSize.height + 16, 44), 132);
                    setInputHeight(newHeight);
                  }}
                  keyboardType="default"
                  returnKeyType={messageText.trim() ? 'send' : 'default'}
                  blurOnSubmit={false}
                  onFocus={() => {
                    setShowEmojiPicker(false);
                    setShowAttachOptions(false);
                    if (chatId && textInputRef.current && messageText) {
                      setTimeout(() => {
                        textInputRef.current?.setNativeProps({ selection: { start: messageText.length, end: messageText.length } });
                      }, 0);
                    }
                  }}
                />
                <Pressable
                  onPress={messageText.trim() ? handleSendMessage : undefined}
                  onPressIn={!messageText.trim() ? startRecording : undefined}
                  onPressOut={!messageText.trim() ? () => stopRecording(false) : undefined}
                  disabled={isRecording && !messageText.trim()}
                  className={clsx(
                    'rounded-full p-3',
                    messageText.trim()
                      ? 'bg-[#337E84]'
                      : (isRecording ? 'bg-red-500' : 'bg-[#337E84]')
                  )}
                  accessibilityLabel={messageText.trim() ? 'Send message' : 'Hold to record voice message'}
                >
                  <Feather
                    name={messageText.trim() ? 'send' : 'mic'}
                    size={20}
                    color="white"
                  />
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </View>
      
      </KeyboardAvoidingView>
      
      <EmojiPicker
        visible={showEmojiPicker}
        onEmojiSelect={handleEmojiSelect}
        onClose={() => setShowEmojiPicker(false)}
      />
      
      <ImageViewer
        visible={!!viewingImage}
        imageUri={viewingImage || ''}
        onClose={() => setViewingImage(null)}
      />
      
      {viewingVideo && <VideoViewerModal videoUrl={viewingVideo} onClose={() => setViewingVideo(null)} />}
      
      {user && (
        <MessageActionMenu
          visible={!!actionMenuMessage}
          message={actionMenuMessage}
          isMyMessage={actionMenuMessage?.senderId === user?.uid}
          currentUserId={user.uid}
          onClose={() => setActionMenuMessage(null)}
          onReactionSelect={handleReactionSelect}
          onReply={() => {
            if (actionMenuMessage) {
              setReplyingTo(actionMenuMessage);
            }
          }}
          onEdit={() => {
            if (actionMenuMessage) {
              setEditingMessage(actionMenuMessage);
            }
          }}
          onDeleteForEveryone={async () => {
            if (!actionMenuMessage || !user || !chatId) return;
            try {
              await deleteMessageForEveryone(chatId, actionMenuMessage.id, user.uid);
            } catch (error) {
              if (__DEV__) console.error('Error deleting message for everyone:', error);
              Alert.alert(t('common.error'), t('messages.failedToDelete'));
            }
          }}
          onDeleteForMe={async () => {
            if (!actionMenuMessage || !user || !chatId) return;
            try {
              await deleteMessageForMe(chatId, actionMenuMessage.id, user.uid);
            } catch (error) {
              if (__DEV__) console.error('Error deleting message for me:', error);
              Alert.alert(t('common.error'), t('messages.failedToDelete'));
            }
          }}
        />
      )}
      
      <EditMessageModal
        visible={!!editingMessage}
        message={editingMessage}
        onClose={() => setEditingMessage(null)}
        onSave={async (newText) => {
          if (!editingMessage || !user || !chatId) return;
          try {
            await editMessage(chatId, editingMessage.id, newText, user.uid);
            setEditingMessage(null);
          } catch (error) {
            if (__DEV__) console.error('Error editing message:', error);
            Alert.alert(t('common.error'), t('messages.failedToEdit'));
          }
        }}
      />
    </Screen>
  );
};

// Video Viewer Component
const VideoViewerModal = ({ videoUrl, onClose }: { videoUrl: string; onClose: () => void }) => {
  const insets = useSafeAreaInsets();
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
  const player = useVideoPlayer(videoUrl, (player) => {
    player.loop = false;
    player.play();
  });
  
  return (
    <Modal
      visible={!!videoUrl}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.95)' }}>
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            paddingTop: insets.top,
            paddingBottom: 16,
            paddingHorizontal: 16,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <TouchableOpacity
              onPress={onClose}
              style={{
                width: 40,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 20,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
              }}
              activeOpacity={0.7}
            >
              <Feather name="x" size={24} color="white" />
            </TouchableOpacity>
          </View>
        </View>
        
        <Pressable
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onPress={onClose}
        >
          <VideoView
            player={player}
            style={{
              width: SCREEN_WIDTH,
              height: SCREEN_HEIGHT,
            }}
            contentFit="contain"
            nativeControls
          />
        </Pressable>
      </View>
    </Modal>
  );
};

export default ChatScreen;
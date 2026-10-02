import Feather from '@expo/vector-icons/Feather';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  TextInput,
  View,
} from 'react-native';

const ICON_HIT_SLOP = { top: 8, right: 8, bottom: 8, left: 8 } as const;
const MAX_CHARS = 4000;

export type ChatMessageComposerHandle = {
  getTrimmedText: () => string;
  setText: (text: string) => void;
  appendText: (fragment: string) => void;
  clear: () => void;
  focus: () => void;
};

type Props = {
  chatId?: string;
  isDark: boolean;
  colorScheme: string | null | undefined;
  locked: boolean;
  sending: boolean;
  isRecording: boolean;
  iconColor: string;
  sendIconStyle: StyleProp<ViewStyle>;
  micIconStyle: StyleProp<ViewStyle>;
  updateComposerSendMic: (hasText: boolean) => void;
  onTypingActivity: (hasTrimmedText: boolean) => void;
  onSend: () => void;
  onStartRecording: () => void;
  onStopRecording: (cancel: boolean) => void;
  onOpenAttach: () => void;
  onDismissOverlays: () => void;
};

const ChatMessageComposerInner = forwardRef<ChatMessageComposerHandle, Props>(
  function ChatMessageComposer(
    {
      chatId,
      isDark,
      colorScheme,
      locked,
      sending,
      isRecording,
      iconColor,
      onTypingActivity,
      onSend,
      onStartRecording,
      onStopRecording,
      onOpenAttach,
      onDismissOverlays,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const [messageText, setMessageText] = useState('');
    const textInputRef = useRef<TextInput>(null);
    const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const messageTextRef = useRef('');

    const applyText = useCallback(
      (next: string) => {
        const clipped = next.length > MAX_CHARS ? next.slice(0, MAX_CHARS) : next;
        messageTextRef.current = clipped;
        setMessageText(clipped);
        const hasText = clipped.trim().length > 0;
        onTypingActivity(hasText);
        return clipped;
      },
      [onTypingActivity],
    );

    useImperativeHandle(
      ref,
      () => ({
        getTrimmedText: () => messageTextRef.current.trim(),
        setText: (text: string) => {
          applyText(text);
        },
        appendText: (fragment: string) => {
          applyText(messageTextRef.current + fragment);
        },
        clear: () => {
          if (draftSaveTimerRef.current) {
            clearTimeout(draftSaveTimerRef.current);
            draftSaveTimerRef.current = null;
          }
          messageTextRef.current = '';
          setMessageText('');
          onTypingActivity(false);
        },
        focus: () => {
          textInputRef.current?.focus();
        },
      }),
      [applyText, onTypingActivity],
    );

    useEffect(() => {
      return () => {
        if (draftSaveTimerRef.current) {
          clearTimeout(draftSaveTimerRef.current);
          draftSaveTimerRef.current = null;
        }
      };
    }, []);

    const hasText = messageText.trim().length > 0;

    const onChangeText = useCallback(
      (text: string) => {
        const clipped = applyText(text);
        if (!chatId) return;
        if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = setTimeout(() => {
          draftSaveTimerRef.current = null;
          AsyncStorage.setItem(`draft_${chatId}`, clipped).catch(() => {});
        }, 350);
      },
      [applyText, chatId],
    );

    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          paddingHorizontal: 12,
          paddingVertical: 8,
          columnGap: 10,
          minHeight: 52,
        }}
      >
        <Pressable
          onPress={() => {
            if (locked) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onOpenAttach();
          }}
          onLongPress={() => {
            if (locked) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onOpenAttach();
          }}
          delayLongPress={400}
          style={{
            width: 48,
            height: 48,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: locked ? 0.45 : 1,
          }}
          hitSlop={ICON_HIT_SLOP}
          accessibilityLabel={t('a11y.attachment')}
        >
          <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="paperclip" size={22} color={iconColor} />
          </View>
        </Pressable>

        <View
          style={{
            flex: 1,
            backgroundColor: isDark ? '#1f2937' : '#ffffff',
            borderRadius: 20,
            minHeight: 40,
            maxHeight: 100,
            paddingVertical: 8,
            paddingHorizontal: 12,
          }}
        >
          <TextInput
            ref={textInputRef}
            placeholder={t('messages.typeMessage')}
            placeholderTextColor={colorScheme === 'dark' ? '#6b7280' : '#8696a0'}
            value={messageText}
            onChangeText={onChangeText}
            multiline
            scrollEnabled
            maxLength={MAX_CHARS}
            editable={!locked}
            style={{
              fontSize: 16,
              lineHeight: 22,
              color: isDark ? '#f9fafb' : '#111827',
              minHeight: 24,
              maxHeight: 84,
              textAlignVertical: 'top',
            }}
            returnKeyType="default"
            blurOnSubmit={false}
            onFocus={() => {
              if (locked) return;
              onDismissOverlays();
            }}
          />
        </View>

        <Pressable
          disabled={sending || locked}
          onPress={hasText && !sending && !locked ? onSend : undefined}
          onPressIn={!hasText && !sending && !locked ? onStartRecording : undefined}
          onPressOut={!hasText && !sending && !locked ? () => onStopRecording(false) : undefined}
          style={{
            width: 48,
            height: 48,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: sending || locked ? 0.5 : 1,
          }}
          hitSlop={ICON_HIT_SLOP}
          accessibilityLabel={
            hasText ? t('messages.sendMessageA11y') : t('messages.recordVoiceMessageA11y')
          }
        >
          {sending ? (
            <ActivityIndicator size="small" color={iconColor} />
          ) : hasText ? (
            <Feather name="send" size={22} color={iconColor} />
          ) : (
            <Feather
              name={isRecording ? 'square' : 'mic'}
              size={22}
              color={isRecording ? '#ef4444' : iconColor}
            />
          )}
        </Pressable>
      </View>
    );
  },
);

const ChatMessageComposer = memo(ChatMessageComposerInner);
export default ChatMessageComposer;

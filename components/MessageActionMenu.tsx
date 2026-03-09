import React from 'react';
import { Modal, Pressable, Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';
import clsx from 'clsx';
import { ChatMessage } from '@/lib/types/chat';
import { useTheme } from '@/contexts/ThemeContext';

const REACTION_EMOJIS = ['❤️', '😂', '👍', '😮', '😢', '👎'];

interface MessageActionMenuProps {
  visible: boolean;
  message: ChatMessage | null;
  isMyMessage: boolean;
  currentUserId: string;
  onClose: () => void;
  onReactionSelect: (messageId: string, emoji: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onDeleteForEveryone: () => void;
  onDeleteForMe: () => void;
}

export const MessageActionMenu: React.FC<MessageActionMenuProps> = ({
  visible,
  message,
  isMyMessage,
  currentUserId,
  onClose,
  onReactionSelect,
  onReply,
  onEdit,
  onDeleteForEveryone,
  onDeleteForMe,
}) => {
  const { isDark, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const textColor = isDark ? 'text-white' : 'text-black';
  const textSecondaryColor = isDark ? 'text-gray-400' : 'text-gray-600';
  const bgColor = isDark ? 'bg-gray-900' : 'bg-white';
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200';
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';

  // Don't show menu if message is deleted for everyone
  if (!message || message.deleted) {
    return null;
  }

  // Only allow editing text messages
  const canEdit = isMyMessage && message.type === 'text' && !message.deleted;

  const handleReactionPress = (emoji: string) => {
    onReactionSelect(message.id, emoji);
    // Don't close menu on reaction - allow multiple reactions
  };

  const handleCopy = async () => {
    if (message?.text) {
      await Clipboard.setStringAsync(message.text);
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={{ flex: 1 }} onPress={onClose}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)' }]} pointerEvents="none" />
        <View
          style={{
            position: 'absolute',
            bottom: insets.bottom + 20,
            left: 20,
            right: 20,
          }}
          className={clsx('rounded-2xl shadow-lg', bgColor, borderColor, 'border')}
        >
          {/* Reactions Section */}
          <View className={clsx('px-4 py-3 border-b', borderColor)}>
            <View style={styles.reactionsContainer}>
              {REACTION_EMOJIS.map((emoji) => {
                const userReacted = message.reactions?.[emoji]?.includes(currentUserId);
                return (
                  <Pressable
                    key={emoji}
                    onPress={() => handleReactionPress(emoji)}
                    style={[
                      styles.emojiButton,
                      userReacted && styles.emojiButtonActive,
                    ]}
                  >
                    <Text style={styles.emojiText}>{emoji}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Actions Section */}
          {message?.text && !message.deleted && (
            <Pressable
              onPress={handleCopy}
              className={clsx(
                'flex-row items-center px-4 py-4 border-b',
                borderColor
              )}
            >
              <Feather name="copy" size={20} color={iconColor} />
              <Text className={clsx('ml-3 text-base', textColor)}>Copy</Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => {
              onReply();
              onClose();
            }}
            className={clsx(
              'flex-row items-center px-4 py-4 border-b',
              borderColor
            )}
          >
            <Feather name="corner-up-left" size={20} color={iconColor} />
            <Text className={clsx('ml-3 text-base', textColor)}>Reply</Text>
          </Pressable>

          {canEdit && (
            <Pressable
              onPress={() => {
                onEdit();
                onClose();
              }}
              className={clsx(
                'flex-row items-center px-4 py-4 border-b',
                borderColor
              )}
            >
              <Feather name="edit-2" size={20} color={iconColor} />
              <Text className={clsx('ml-3 text-base', textColor)}>Edit</Text>
            </Pressable>
          )}

          {isMyMessage && (
            <Pressable
              onPress={() => {
                onDeleteForEveryone();
                onClose();
              }}
              className={clsx(
                'flex-row items-center px-4 py-4 border-b',
                borderColor
              )}
            >
              <Feather name="trash-2" size={20} color="#ef4444" />
              <Text className="ml-3 text-base text-red-500">Delete for Everyone</Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => {
              onDeleteForMe();
              onClose();
            }}
            className={clsx(
              'flex-row items-center px-4 py-4 border-b',
              borderColor
            )}
          >
            <Feather name="x-circle" size={20} color={iconColor} />
            <Text className={clsx('ml-3 text-base', textColor)}>Delete for Me</Text>
          </Pressable>

          <Pressable
            onPress={onClose}
            className="flex-row items-center px-4 py-4"
          >
            <Feather name="x" size={20} color={iconColor} />
            <Text className={clsx('ml-3 text-base', textColor)}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  reactionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  emojiButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  emojiButtonActive: {
    backgroundColor: 'rgba(51, 126, 132, 0.2)',
  },
  emojiText: {
    fontSize: 24,
  },
});

export default MessageActionMenu;


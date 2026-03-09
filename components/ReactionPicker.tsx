import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Dimensions } from 'react-native';
import { ChatMessage } from '@/lib/types/chat';
import { useTheme } from '@/contexts/ThemeContext';
import clsx from 'clsx';

const REACTION_EMOJIS = ['❤️', '😂', '👍', '😮', '😢', '👎'];

interface ReactionPickerProps {
  visible: boolean;
  message: ChatMessage | null;
  currentUserId: string;
  onReactionSelect: (messageId: string, emoji: string) => void;
  onClose: () => void;
}

export const ReactionPicker: React.FC<ReactionPickerProps> = ({
  visible,
  message,
  currentUserId,
  onReactionSelect,
  onClose,
}) => {
  const { isDark } = useTheme();

  if (!message) return null;

  const handleReactionPress = (emoji: string) => {
    onReactionSelect(message.id, emoji);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[
            styles.pickerContainer,
            { backgroundColor: isDark ? '#374151' : '#FFFFFF' },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.pickerContent}>
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
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerContainer: {
    borderRadius: 24,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  pickerContent: {
    flexDirection: 'row',
    gap: 8,
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

export default ReactionPicker;


import React, { useState, useEffect, useRef } from 'react';
import { Modal, Pressable, Text, TextInput, View, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import clsx from 'clsx';
import { ChatMessage } from '@/lib/types/chat';
import { useTheme } from '@/contexts/ThemeContext';

interface EditMessageModalProps {
  visible: boolean;
  message: ChatMessage | null;
  onClose: () => void;
  onSave: (newText: string) => void;
}

export const EditMessageModal: React.FC<EditMessageModalProps> = ({
  visible,
  message,
  onClose,
  onSave,
}) => {
  const { isDark, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [editText, setEditText] = useState('');
  const textInputRef = useRef<TextInput>(null);
  
  const textColor = isDark ? 'text-white' : 'text-black';
  const textSecondaryColor = isDark ? 'text-gray-400' : 'text-gray-600';
  const bgColor = isDark ? 'bg-gray-900' : 'bg-white';
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200';
  const inputBgColor = isDark ? 'bg-gray-800' : 'bg-gray-100';
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';

  // Initialize edit text when modal opens
  useEffect(() => {
    if (visible && message?.text) {
      setEditText(message.text);
      // Focus input after a short delay to ensure modal is fully rendered
      setTimeout(() => {
        textInputRef.current?.focus();
      }, 100);
    } else {
      setEditText('');
    }
  }, [visible, message]);

  const handleSave = () => {
    const trimmedText = editText.trim();
    if (trimmedText && trimmedText !== message?.text) {
      onSave(trimmedText);
    }
    onClose();
  };

  const handleCancel = () => {
    setEditText(message?.text || '');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleCancel}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
        onPress={handleCancel}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            paddingBottom: insets.bottom,
          }}
          className={clsx(bgColor, 'rounded-t-3xl')}
        >
          <View className="px-4 py-4">
            <View className="flex-row items-center justify-between mb-4">
              <Text className={clsx('text-lg font-semibold', textColor)}>Edit Message</Text>
              <Pressable onPress={handleCancel}>
                <Feather name="x" size={24} color={iconColor} />
              </Pressable>
            </View>

            <TextInput
              ref={textInputRef}
              value={editText}
              onChangeText={setEditText}
              placeholder="Type a message..."
              placeholderTextColor={colorScheme === 'dark' ? '#9ca3af' : '#6b7280'}
              multiline
              maxLength={1000}
              className={clsx(
                'rounded-2xl px-4 py-3 mb-4',
                inputBgColor,
                textColor
              )}
              style={{
                minHeight: 100,
                textAlignVertical: 'top',
                fontSize: 16,
              }}
              autoFocus
            />

            <View className="flex-row gap-3">
              <Pressable
                onPress={handleCancel}
                className={clsx(
                  'flex-1 py-3 rounded-2xl items-center border',
                  borderColor
                )}
              >
                <Text className={clsx('text-base font-medium', textColor)}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                disabled={!editText.trim() || editText.trim() === message?.text}
                className={clsx(
                  'flex-1 py-3 rounded-2xl items-center',
                  !editText.trim() || editText.trim() === message?.text
                    ? 'bg-gray-400'
                    : 'bg-[#337E84]'
                )}
              >
                <Text className="text-base font-medium text-white">Save</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default EditMessageModal;


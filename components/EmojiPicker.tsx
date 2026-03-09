import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import clsx from 'clsx';
import { useThemeClassName } from '@/lib/themeUtils';

const EMOJI_CATEGORIES = [
  { name: '😀', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔'] },
  { name: '❤️', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐'] },
  { name: '👍', emojis: ['👍', '👎', '👊', '✊', '🤛', '🤜', '🤞', '✌️', '🤟', '🤘', '👌', '🤌', '🤏', '👈', '👉', '👆', '🖕', '👇', '☝️', '👋', '🤚', '🖐️', '✋', '🖖', '👏', '🙌', '🤲', '🤝', '🙏', '✍️'] },
  { name: '🌍', emojis: ['🌍', '🌎', '🌏', '🌐', '🗺️', '🧭', '🏔️', '⛰️', '🌋', '🗻', '🏕️', '🏖️', '🏜️', '🏝️', '🏞️', '🏟️', '🏛️', '🏗️', '🧱', '🏘️', '🏚️', '🏠', '🏡', '🏢', '🏣', '🏤', '🏥', '🏦', '🏨', '🏩'] },
  { name: '🍕', emojis: ['🍕', '🍔', '🍟', '🌭', '🍿', '🧂', '🥓', '🥚', '🍳', '🥞', '🥯', '🍞', '🥐', '🥨', '🧀', '🥗', '🥙', '🥪', '🌮', '🌯', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🍤', '🍙'] },
];

interface EmojiPickerProps {
  visible: boolean;
  onEmojiSelect: (emoji: string) => void;
  onClose: () => void;
}

const EmojiPicker = ({ visible, onEmojiSelect, onClose }: EmojiPickerProps) => {
  const [selectedCategory, setSelectedCategory] = useState(0);
  const bgColor = useThemeClassName('bg-white', 'bg-gray-900');
  const borderColor = useThemeClassName('border-gray-200', 'border-gray-700');
  const textColor = useThemeClassName('text-black', 'text-white');

  if (!visible) return null;

  return (
    <>
      <Pressable
        className="absolute inset-0 bg-black/20"
        onPress={onClose}
      />
      <View className={clsx(
        'absolute bottom-20 left-4 right-4 rounded-2xl shadow-lg z-10 max-h-64',
        bgColor,
        borderColor,
        'border'
      )}>
        {/* Category Selector */}
        <View className={clsx('flex-row border-b px-2 py-2', borderColor)}>
          {EMOJI_CATEGORIES.map((category, index) => (
            <Pressable
              key={index}
              onPress={() => setSelectedCategory(index)}
              className={clsx(
                'px-3 py-1 rounded-lg',
                selectedCategory === index && 'bg-gray-200 dark:bg-gray-700'
              )}
            >
              <Text style={{ fontSize: 20 }}>{category.name}</Text>
            </Pressable>
          ))}
        </View>

        {/* Emoji Grid */}
        <FlatList
          data={EMOJI_CATEGORIES[selectedCategory].emojis}
          numColumns={8}
          contentContainerStyle={{ padding: 8 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onEmojiSelect(item);
                onClose();
              }}
              className="w-10 h-10 items-center justify-center"
            >
              <Text style={{ fontSize: 24 }}>{item}</Text>
            </Pressable>
          )}
          keyExtractor={(item, index) => `${selectedCategory}-${index}`}
        />
      </View>
    </>
  );
};

export default EmojiPicker;


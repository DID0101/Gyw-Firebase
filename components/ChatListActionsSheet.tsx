import Feather from '@expo/vector-icons/Feather';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';

import { useTheme } from '@/contexts/ThemeContext';
import { useThemeClassName } from '@/lib/themeUtils';

type Props = {
  visible: boolean;
  chatTitle: string;
  isPinned: boolean;
  isMuted: boolean;
  isArchived: boolean;
  onClose: () => void;
  onSelect: (action: 'pin' | 'mute' | 'archive' | 'delete') => void;
};

function Row({
  icon,
  label,
  danger,
  onPress,
  borderColor,
  textColor,
  dangerColor,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  danger?: boolean;
  onPress: () => void;
  borderColor: string;
  textColor: string;
  dangerColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={clsx('flex-row items-center px-4 py-3.5 border-b', borderColor)}
      style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
    >
      <Feather name={icon} size={22} color={danger ? dangerColor : textColor} />
      <Text
        className={clsx('ml-3 text-base flex-1', danger ? '' : '')}
        style={{ color: danger ? dangerColor : textColor }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function ChatListActionsSheet({
  visible,
  chatTitle,
  isPinned,
  isMuted,
  isArchived,
  onClose,
  onSelect,
}: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useTheme();
  const { height } = useWindowDimensions();
  const textColor = useThemeClassName('text-black', 'text-white');
  const borderColor = useThemeClassName('border-gray-200', 'border-gray-700');
  const cardBg = useThemeClassName('bg-white', 'bg-gray-900');
  const dangerColor = '#dc2626';

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
        onPress={onClose}
      >
        <Pressable
          className={clsx('rounded-t-2xl overflow-hidden', cardBg)}
          style={{ maxHeight: height * 0.55 }}
          onPress={(e) => e.stopPropagation()}
        >
          <Text className={clsx('px-4 pt-4 pb-2 text-sm font-semibold', textColor)} numberOfLines={1}>
            {chatTitle}
          </Text>
          <Row
            icon="bookmark"
            label={isPinned ? t('chats.listActions.unpin') : t('chats.listActions.pin')}
            onPress={() => onSelect('pin')}
            borderColor={borderColor}
            textColor={colorScheme === 'dark' ? '#f3f4f6' : '#111827'}
            dangerColor={dangerColor}
          />
          <Row
            icon={isMuted ? 'bell' : 'bell-off'}
            label={isMuted ? t('chats.listActions.unmute') : t('chats.listActions.mute')}
            onPress={() => onSelect('mute')}
            borderColor={borderColor}
            textColor={colorScheme === 'dark' ? '#f3f4f6' : '#111827'}
            dangerColor={dangerColor}
          />
          <Row
            icon="archive"
            label={isArchived ? t('chats.listActions.unarchive') : t('chats.listActions.archive')}
            onPress={() => onSelect('archive')}
            borderColor={borderColor}
            textColor={colorScheme === 'dark' ? '#f3f4f6' : '#111827'}
            dangerColor={dangerColor}
          />
          <Row
            icon="trash-2"
            label={t('chats.listActions.deleteForMe')}
            danger
            onPress={() => onSelect('delete')}
            borderColor={borderColor}
            textColor={colorScheme === 'dark' ? '#f3f4f6' : '#111827'}
            dangerColor={dangerColor}
          />
          <Row
            icon="x"
            label={t('common.cancel')}
            onPress={onClose}
            borderColor={borderColor}
            textColor={colorScheme === 'dark' ? '#f3f4f6' : '#111827'}
            dangerColor={dangerColor}
          />
          <View style={{ height: 12 }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

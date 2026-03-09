import { MaterialIcons } from '@expo/vector-icons';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import {
  useChannelContext,
  useChannelPreviewDisplayName,
} from 'stream-chat-expo';

import { useTheme } from '@/contexts/ThemeContext';
import { useThemeClassName } from '@/lib/themeUtils';
import { checkIfDMChannel } from '../lib/utils';
import ChannelTitle from './ChannelTitle';
import PreviewAvatar from './PreviewAvatar';

const MessageListHeader = () => {
  const { t } = useTranslation();
  const { channel } = useChannelContext();
  const channelName = useChannelPreviewDisplayName(channel);
  const isDMChannel = checkIfDMChannel(channel);
  const { colorScheme } = useTheme();
  const bgColor = useThemeClassName('bg-white', 'bg-gray-800');
  const borderColor = useThemeClassName('border-gray-100', 'border-gray-700');
  const textColor = useThemeClassName('text-black', 'text-white');
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';

  const text = isDMChannel
    ? t('messages.conversationBetween', { name: channelName })
    : t('messages.conversationBetweenMembers');

  return (
    <View className="items-center gap-3 mt-8 sm:mt-14 mb-8 px-4">
      <PreviewAvatar channel={channel!} size={80} fontSize={40} />
      <ChannelTitle channel={channel} className="text-xl sm:text-2xl font-semibold text-center px-2" />
      <View className={clsx('w-full max-w-[280px] items-start justify-center flex flex-row px-4 sm:px-6 py-4 rounded-xl border-[2px] shadow', bgColor, borderColor, useThemeClassName('shadow-gray-100', 'shadow-gray-900'))}>
        <MaterialIcons name="people-outline" size={18} color={iconColor} />
        <Text className={clsx('text-center flex-1 text-sm sm:text-base', textColor)}>{text}</Text>
      </View>
    </View>
  );
};

export default MessageListHeader;

import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import {
  useChannelContext,
  useChannelPreviewDisplayName,
} from 'stream-chat-expo';

import { checkIfDMChannel } from '../lib/utils';
import ChannelTitle from './ChannelTitle';
import PreviewAvatar from './PreviewAvatar';

const MessageListHeader = () => {
  const { t } = useTranslation();
  const { channel } = useChannelContext();
  const channelName = useChannelPreviewDisplayName(channel);
  const isDMChannel = checkIfDMChannel(channel);

  const text = isDMChannel
    ? t('messages.conversationBetween', { name: channelName })
    : t('messages.conversationBetweenMembers');

  return (
    <View className="items-center gap-3 mt-8 sm:mt-14 mb-8 px-4">
      <PreviewAvatar channel={channel!} size={80} fontSize={40} />
      <ChannelTitle channel={channel} className="text-xl sm:text-2xl font-semibold text-center px-2" />
      <View className="w-full max-w-[280px] items-start justify-center flex flex-row px-4 sm:px-6 py-4 bg-white rounded-xl border-[2px] border-gray-100 shadow shadow-gray-100">
        <MaterialIcons name="people-outline" size={18} color="black" />
        <Text className="text-center flex-1 text-sm sm:text-base">{text}</Text>
      </View>
    </View>
  );
};

export default MessageListHeader;

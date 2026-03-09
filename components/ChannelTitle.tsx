import clsx from 'clsx';
import { Text } from 'react-native';
import { Channel } from 'stream-chat';
import { useChannelPreviewDisplayName } from 'stream-chat-expo';

import { useThemeClassName } from '@/lib/themeUtils';

interface ChannelTitleProps {
  channel: Channel;
  className?: string;
}

const ChannelTitle = ({
  channel,
  className = 'text-base font-bold',
}: ChannelTitleProps) => {
  const channelName = useChannelPreviewDisplayName(channel);
  const textColor = useThemeClassName('text-black', 'text-white');
  return <Text className={clsx(className, textColor)}>{channelName}</Text>;
};

export default ChannelTitle;

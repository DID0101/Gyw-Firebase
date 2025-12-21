import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCalls } from '@stream-io/video-react-native-sdk';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Channel as ChannelType } from 'stream-chat';
import {
  Channel,
  DeepPartial,
  MessageList,
  Theme,
  useChatContext,
} from 'stream-chat-expo';

import AttachButton from '@/components/AttachButton';
import Button from '@/components/Button';
import CallMessageSimple from '@/components/CallMessageSimple';
import ChannelTitle from '@/components/ChannelTitle';
import CustomMessageInput from '@/components/CustomMessageInput';
import MessageAvatar from '@/components/MessageAvatar';
import MessageListHeader from '@/components/MessageListHeader';
import PreviewAvatar from '@/components/PreviewAvatar';
import Screen from '@/components/Screen';
import ScreenLoading from '@/components/ScreenLoading';
import SendButton from '@/components/SendButton';

const myMessageTheme: DeepPartial<Theme> = {
  messageSimple: {
    content: {
      senderMessageBackgroundColor: '#175dee',
      markdown: {
        text: {
          color: 'white',
        },
      },
    },
  },
};

const ChatScreen = () => {
  const { id: channelId } = useLocalSearchParams<{ id: string }>();
  const { client: chatClient } = useChatContext();
  const router = useRouter();

  const [channel, setChannel] = useState<ChannelType>();
  const [loading, setLoading] = useState(true);
  const [activeCall] = useCalls();

  useEffect(() => {
    const loadChannel = async () => {
      const channel = chatClient.channel('messaging', channelId);
      await channel.watch();

      setChannel(channel);
      setLoading(false);
    };

    if (chatClient && !channel) loadChannel();
  }, [channelId, channel, chatClient]);

  const startAudioCall = async () => {
    router.navigate({
      pathname: `/call/[id]`,
      params: { id: channelId, updateCall: 'true' },
    });
  };

  const startVideoCall = async () => {
    router.navigate({
      pathname: `/call/[id]`,
      params: { id: channelId, updateCall: 'true', video: 'true' },
    });
  };

  const callIsActive = !!activeCall && activeCall?.id !== channelId;

  if (loading) {
    return <ScreenLoading />;
  }

  return (
    <Screen className="flex-1 bg-white" viewClassName="flex-1 pb-safe">
      <View className="pl-1 pr-2 pb-1 flex flex-row items-center justify-between w-full min-h-[40px] flex-shrink-0">
        <View className="flex flex-row items-center gap-2 flex-1 min-w-0">
          <Button variant="plain" onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color="black" />
          </Button>
          <PreviewAvatar channel={channel!} size={28} fontSize={14} />
          <View className="flex-1 min-w-0">
            <ChannelTitle channel={channel!} className="truncate" />
          </View>
        </View>
        <View className="flex flex-row items-center gap-3 flex-shrink-0">
          <Button
            variant="plain"
            onPress={startVideoCall}
            disabled={callIsActive}
          >
            <Feather name="video" size={24} color="black" />
          </Button>
          <Button
            variant="plain"
            onPress={startAudioCall}
            disabled={callIsActive}
          >
            <Feather name="phone" size={22} color="black" />
          </Button>
        </View>
      </View>
      <View className="flex-1 min-h-0">
        <Channel
          myMessageTheme={myMessageTheme}
          channel={channel!}
          keyboardVerticalOffset={60}
          keyboardBehavior="padding"
          hasCommands={false}
          AttachButton={AttachButton}
          SendButton={SendButton}
          EmptyStateIndicator={MessageListHeader}
          MessageAvatar={MessageAvatar}
          MessageSimple={CallMessageSimple}
          reactionListPosition="bottom"
        >
          <MessageList FooterComponent={MessageListHeader} />
          <CustomMessageInput />
        </Channel>
      </View>
    </Screen>
  );
};

export default ChatScreen;

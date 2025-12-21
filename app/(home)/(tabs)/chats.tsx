import Feather from '@expo/vector-icons/Feather';
import { Link, useRouter } from 'expo-router';
import { View } from 'react-native';
import { Channel } from 'stream-chat';
import { ChannelList, useChatContext } from 'stream-chat-expo';

import AppMenu from '@/components/AppMenu';
import Button from '@/components/Button';
import PreviewAvatar from '@/components/PreviewAvatar';
import Screen from '@/components/Screen';
import ScreenLoading from '@/components/ScreenLoading';

const ChatsScreen = () => {
  const { client } = useChatContext();
  const router = useRouter();

  const goToChannel = (channel: Channel) => {
    router.navigate({
      pathname: '/chat/[id]',
      params: { id: channel.id! },
    });
  };

  return (
    <Screen className="bg-white" viewClassName="flex-1 px-2 sm:px-4">
      <View className="flex flex-row items-center justify-between w-full min-h-[40px] flex-shrink-0">
        <AppMenu />
        <View className="flex flex-row items-center gap-2 sm:gap-4">
          <Button variant="plain">
            <Feather name="camera" size={20} />
          </Button>
          <Link href="/new-message" asChild>
            <Button variant="plain" className="pl-2 sm:pl-4 py-1">
              <Feather name="edit" size={18} />
            </Button>
          </Link>
        </View>
      </View>
      <View className="flex-1 min-h-0">
        <ChannelList
          filters={{
            type: 'messaging',
            members: { $in: [client.userID!] },
          }}
          sort={{ last_message_at: -1 }}
          onSelect={goToChannel}
          LoadingIndicator={ScreenLoading}
          PreviewAvatar={PreviewAvatar}
        />
      </View>
    </Screen>
  );
};

export default ChatsScreen;

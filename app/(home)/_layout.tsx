import { useUser } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  StreamVideo,
  StreamVideoClient,
} from '@stream-io/video-react-native-sdk';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StreamChat } from 'stream-chat';
import {
  Chat,
  DeepPartial as ChatDeepPartial,
  Theme as ChatTheme,
  OverlayProvider,
} from 'stream-chat-expo';

import ScreenLoading from '@/components/ScreenLoading';

const tokenProvider = async (userId: string) => {
  const response = await fetch('/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId }),
  });
  const data = await response.json();
  return data.token;
};

const chatTheme: ChatDeepPartial<ChatTheme> = {
  colors: {
    white_snow: 'white',
  },
  channelPreview: {
    container: {
      borderBottomWidth: 0,
      paddingLeft: 0,
    },
    title: {
      fontWeight: '500',
    },
    unreadContainer: {
      backgroundColor: '#2c6bed',
    },
  },
  messageList: {
    container: {
      flex: 1,
    },
    contentContainer: {
      justifyContent: 'flex-end',
      flexGrow: 1,
      flexShrink: 1,
    },
  },
  inlineDateSeparator: {
    container: {
      backgroundColor: 'transparent',
    },
    text: {
      color: '#6B7280',
      fontSize: 12,
      fontWeight: '600',
    },
  },
  messageSimple: {
    content: {
      receiverMessageBackgroundColor: '#e9e9e9',
      textContainer: {
        paddingHorizontal: 10,
      },
    },
  },
  messageInput: {
    container: {
      borderTopWidth: 0,
      flexShrink: 0,
      minHeight: 60,
    },
    inputBoxContainer: {
      backgroundColor: '#eeeeef',
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderColor: '#eeeeef',
      flex: 1,
      minHeight: 40,
    },
    audioRecordingButton: {
      micIcon: {
        fill: 'black',
        width: 24,
        height: 24,
        style: {
          marginHorizontal: 2,
        },
      },
    },
  },
};

const API_KEY = process.env.EXPO_PUBLIC_STREAM_API_KEY as string;

const HomeLayout = () => {
  const router = useRouter();
  const { user, isSignedIn } = useUser();
  const [loading, setLoading] = useState(true);
  const [chatClient, setChatClient] = useState<StreamChat>();
  const [videoClient, setVideoClient] = useState<StreamVideoClient>();

  useEffect(() => {
    if (!isSignedIn) {
      router.replace('/sign-in');
    }

    const customProvider = async () => {
      const token = await tokenProvider(user!.id);
      return token;
    };

    const setUpStream = async () => {
      try {
        const chatClient = StreamChat.getInstance(API_KEY);
        const clerkUser = user!;
        
        // Get pending username and contact info from sign-up if exists
        const pendingUsername = await AsyncStorage.getItem('pendingUsername');
        const pendingEmail = await AsyncStorage.getItem('pendingEmail');
        const pendingPhone = await AsyncStorage.getItem('pendingPhone');
        
        const chatUser: any = {
          id: clerkUser.id,
          name: clerkUser.fullName || clerkUser.firstName || 'User',
          image: clerkUser.hasImage ? clerkUser.imageUrl : undefined,
          ...(pendingUsername && { username: pendingUsername }),
        };

        // Store phone and email for searching (prioritize pending from sign-up, then Clerk)
        if (pendingPhone) {
          chatUser.phone = pendingPhone;
          await AsyncStorage.removeItem('pendingPhone');
        } else if (clerkUser.primaryPhoneNumber) {
          chatUser.phone = clerkUser.primaryPhoneNumber;
        }
        
        if (pendingEmail) {
          chatUser.email = pendingEmail;
          await AsyncStorage.removeItem('pendingEmail');
        } else if (clerkUser.primaryEmailAddress) {
          chatUser.email = clerkUser.primaryEmailAddress;
        }

        if (!chatClient.user) {
          await chatClient.connectUser(chatUser, customProvider);
          // Clear pending username after successful connection
          if (pendingUsername) {
            await AsyncStorage.removeItem('pendingUsername');
          }
        } else {
          // User already connected - update their info if we have pending data
          if (pendingEmail || pendingPhone || pendingUsername) {
            await chatClient.upsertUser({
              id: clerkUser.id,
              ...(pendingUsername && { username: pendingUsername }),
              ...(pendingPhone && { phone: pendingPhone }),
              ...(pendingEmail && { email: pendingEmail }),
            } as any);
            if (pendingUsername) {
              await AsyncStorage.removeItem('pendingUsername');
            }
          }
        }

        setChatClient(chatClient);
        const videoClient = StreamVideoClient.getOrCreateInstance({
          apiKey: API_KEY,
          user: chatUser,
          tokenProvider: customProvider,
        });
        setVideoClient(videoClient);
      } catch (error) {
        console.error('Error setting up Stream:', error);
      } finally {
        setLoading(false);
      }
    };

    if (user) setUpStream();

    return () => {
      if (!isSignedIn) {
        chatClient?.disconnectUser();
        videoClient?.disconnectUser();
      }
    };
  }, [user, videoClient, chatClient, isSignedIn, router]);

  if (loading) return <ScreenLoading />;

  return (
    <OverlayProvider>
      <Chat client={chatClient!} style={chatTheme}>
        <StreamVideo client={videoClient!}>
          <Stack>
            <Stack.Screen
              name="(modal)"
              options={{
                presentation: 'modal',
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="(tabs)"
              options={{
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="chat/[id]"
              options={{
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="call/[id]"
              options={{
                headerShown: false,
                animation: 'none',
              }}
            />
          </Stack>
        </StreamVideo>
      </Chat>
    </OverlayProvider>
  );
};

export default HomeLayout;

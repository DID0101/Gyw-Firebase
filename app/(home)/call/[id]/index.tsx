import { useUser } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CallContent,
  CallingState,
  DeepPartial,
  HangUpCallButton,
  IncomingCall,
  OutgoingCall,
  RingingCallContent,
  StreamTheme,
  Theme,
  ToggleCameraFaceButton,
  ToggleAudioPublishingButton as ToggleMic,
  useCall,
  useCallStateHooks,
} from '@stream-io/video-react-native-sdk';
import { useGlobalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useChatContext } from 'stream-chat-expo';

import ToggleVideo from '@/components/ToggleVideo';

const svgContainerStyle = {
  backgroundColor: '#373737',
  width: 48,
  height: 48,
  borderRadius: 24,
};

// @ts-expect-error
const theme: DeepPartial<Theme> = {
  colors: {
    buttonSecondary: '#373737',
    buttonWarning: '#373737',
  },
  joinCallButton: {
    container: svgContainerStyle,
  },
  acceptCallButton: {
    container: svgContainerStyle,
  },
  rejectCallButton: {
    container: svgContainerStyle,
  },
  toggleAudioPublishingButton: {
    svgContainer: svgContainerStyle,
  },
  toggleCameraFaceButton: {
    svgContainer: svgContainerStyle,
  },
  hangupCallButton: {
    svgContainer: {
      ...svgContainerStyle,
      backgroundColor: '#eb5545',
    },
  },
  participantVideoFallback: {
    container: {
      backgroundColor: '#1c1c1ecf',
    },
  },
};

const CallScreen = () => {
  const { updateCall, id: channelId } = useGlobalSearchParams<{ updateCall?: string; id: string }>();
  const { user } = useUser();
  const call = useCall();
  const router = useRouter();
  const { client } = useChatContext();
  const { useCallCallingState, useCallCustomData, useCallSession } = useCallStateHooks();
  const callingState = useCallCallingState();
  const customData = useCallCustomData();
  const session = useCallSession();
  const callStartTime = useRef<Date | null>(null);
  const hasSavedCall = useRef(false);
  
  const isCallTriggeredByMe =
    customData.triggeredBy === user?.id || updateCall === 'true';

  // Track when call actually starts (not just ringing)
  useEffect(() => {
    if (callingState === CallingState.JOINED && !callStartTime.current) {
      callStartTime.current = new Date();
      console.log('Call started at:', callStartTime.current);
    }
  }, [callingState]);

  // Also track when call is created/starting
  useEffect(() => {
    if (!callStartTime.current && call) {
      // Set start time when call object is available
      callStartTime.current = new Date();
      console.log('Call object available, start time set:', callStartTime.current);
    }
  }, [call]);

  // Function to save call history (can be called from multiple places)
  const saveCallHistory = useCallback(async () => {
    if (hasSavedCall.current || !channelId || !client) {
      console.log('Skipping save - already saved or missing data', { hasSaved: hasSavedCall.current, channelId, client: !!client });
      return;
    }
    
    hasSavedCall.current = true;
    console.log('Saving call history for channel:', channelId);
    
    try {
      const channel = client.channel('messaging', channelId);
      if (!channel.initialized) {
        await channel.watch();
      }

      const isVideoCall = customData.video === 'true' || customData.video === true;
      const duration = callStartTime.current 
        ? Math.floor((new Date().getTime() - callStartTime.current.getTime()) / 1000)
        : 0;

      console.log('Call info:', { isVideoCall, duration, hasSession: !!session });

      // Get participant info from call session or channel members
      let participants: Array<{ id: string; name?: string }> = [];
      
      // Try to get from session first
      if (session?.participants) {
        const sessionParticipants = Object.values(session.participants);
        console.log('Session participants:', sessionParticipants);
        participants = sessionParticipants.map((p: any) => ({
          id: p.userId || p.user?.id || '',
          name: p.name || p.user?.name || '',
        })).filter(p => p.id);
      }
      
      // If no participants from session, get from channel members
      if (participants.length === 0 && channel.state?.members) {
        const members = Object.values(channel.state.members);
        console.log('Channel members:', members);
        participants = members.map((m: any) => ({
          id: m.user?.id || m.user_id || '',
          name: m.user?.name || '',
        })).filter(p => p.id && p.id !== client.userID);
      }

      // Fallback: if still no participants, use current user
      if (participants.length === 0 && user) {
        participants = [{ id: user.id, name: user.fullName || '' }];
      }

      console.log('Final participants:', participants);

      // Update channel custom data with call info
      const callHistory = {
        type: isVideoCall ? 'video' : 'audio',
        duration,
        endedAt: new Date().toISOString(),
        participants,
      };

      try {
        await channel.updatePartial({
          set: {
            lastCall: callHistory,
          },
        });
        console.log('Channel updated with call history');
      } catch (updateError) {
        console.error('Error updating channel:', updateError);
      }

      // Send a system message about the call
      try {
        await channel.sendMessage({
          text: isVideoCall ? 'Video call ended' : 'Call ended',
          type: 'system',
          customType: 'call_ended',
          attachments: [],
          silent: false,
        });
        console.log('Call message sent');
      } catch (msgError) {
        console.error('Error sending call message:', msgError);
      }

      // Save to AsyncStorage for calls tab
      const callRecord = {
        id: `${channelId}-${Date.now()}`,
        channelId,
        type: isVideoCall ? 'video' : 'audio',
        duration,
        timestamp: new Date().toISOString(),
        participants,
      };

      console.log('Saving call record to AsyncStorage:', callRecord);

      const existingCalls = await AsyncStorage.getItem('callHistory');
      const calls = existingCalls ? JSON.parse(existingCalls) : [];
      calls.unshift(callRecord);
      // Keep only last 100 calls
      const recentCalls = calls.slice(0, 100);
      await AsyncStorage.setItem('callHistory', JSON.stringify(recentCalls));
      console.log('✅ Call history saved to AsyncStorage, total calls:', recentCalls.length);
      
      // Verify it was saved
      const verify = await AsyncStorage.getItem('callHistory');
      if (verify) {
        const verified = JSON.parse(verify);
        console.log('✅ Verified: AsyncStorage contains', verified.length, 'calls');
      }
    } catch (error) {
      console.error('❌ Error saving call history:', error);
      hasSavedCall.current = false; // Reset so we can try again
    }
  }, [channelId, client, customData, session, user]);

  // Save call history when call ends
  useEffect(() => {
    if (callingState === CallingState.LEFT) {
      console.log('Call state is LEFT, saving history...');
      saveCallHistory();
      // Small delay before navigating back to ensure data is saved
      setTimeout(() => {
        router.back();
      }, 1000);
    }
  }, [callingState, router, saveCallHistory]);

  if (
    [CallingState.RINGING, CallingState.JOINING, CallingState.IDLE].includes(
      callingState
    )
  ) {
    return (
      <StreamTheme style={theme}>
        <View className="flex-1 bg-black">
          <View className="flex-1 bg-white">
            {!isCallTriggeredByMe && <IncomingCall />}
            {isCallTriggeredByMe && <OutgoingCall />}
          </View>
        </View>
      </StreamTheme>
    );
  }

  return (
    <StreamTheme style={theme}>
      <View className="flex-1 bg-black">
        <View className="flex-1 pt-safe bg-white">
          <RingingCallContent
            CallContent={(props) => (
              <CallContent
                {...props}
                layout="spotlight"
                onHangupCallHandler={async () => {
                  console.log('Hang up button pressed, ending call...');
                  // Save call history before ending (in case state doesn't update in time)
                  await saveCallHistory();
                  await call?.endCall();
                }}
                CallControls={(props) => (
                  <View className="bg-[#1c1c1e] w-full h-[110px] pt-7 flex-row justify-center gap-4 rounded-t-2xl">
                    <ToggleCameraFaceButton />
                    <ToggleVideo />
                    <ToggleMic />
                    <HangUpCallButton
                      onHangupCallHandler={props.onHangupCallHandler}
                    />
                  </View>
                )}
              />
            )}
          />
        </View>
      </View>
    </StreamTheme>
  );
};

export default CallScreen;

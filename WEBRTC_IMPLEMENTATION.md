# WebRTC Video/Audio Call Implementation ✅

## Overview

Full WebRTC video and audio calling functionality has been implemented using `react-native-webrtc` and Firebase Firestore for signaling.

## Features Implemented

### ✅ Core Features
- **Video Calls**: Full video calling with local and remote video streams
- **Audio Calls**: Audio-only calling support
- **Call Management**: Create, accept, reject, and end calls
- **Real-time Signaling**: WebRTC signaling via Firestore
- **Call History**: Track call history in Firestore
- **Call Controls**: Mute, video toggle, camera switch

### ✅ UI Features
- **Call Screen**: Full-screen call interface with video/audio support
- **Call Buttons**: Video and audio call buttons in chat header
- **Call Status**: Ringing, active, ended states
- **Picture-in-Picture**: Local video overlay during video calls
- **Call Controls**: Mute, video toggle, camera switch, end call

## Architecture

### Services Created

1. **`lib/services/callService.ts`**
   - Call creation and management
   - Firestore call document handling
   - Signaling message handling
   - Call history retrieval

2. **`lib/services/webrtcService.ts`**
   - WebRTC peer connection management
   - Media stream handling
   - Offer/Answer/ICE candidate exchange
   - Call controls (mute, video toggle, camera switch)

3. **`lib/types/call.ts`**
   - Call and CallSignaling type definitions

### Components Updated

1. **`app/(home)/call/[id]/index.tsx`**
   - Complete WebRTC call screen implementation
   - Video/audio stream rendering
   - Call controls UI
   - Call state management

2. **`app/(home)/chat/[id].tsx`**
   - Added video and audio call buttons
   - Call initiation from chat screen

## How It Works

### 1. Initiating a Call

```typescript
// From chat screen
const callId = await createCall(callerId, receiverId, 'video' | 'audio');
router.push(`/(home)/call/${callId}`);
```

### 2. WebRTC Connection Flow

1. **Caller**:
   - Creates call document in Firestore
   - Gets local media stream (audio/video)
   - Creates WebRTC peer connection
   - Creates offer and sends via signaling
   - Waits for answer

2. **Receiver**:
   - Receives call notification
   - Gets local media stream
   - Creates peer connection
   - Receives offer via signaling
   - Creates answer and sends back
   - Exchanges ICE candidates

3. **Both**:
   - Exchange ICE candidates via signaling
   - Establish peer-to-peer connection
   - Stream audio/video

### 3. Signaling via Firestore

- **Path**: `callSignaling/{callId}/messages/{messageId}`
- **Message Types**: `offer`, `answer`, `ice-candidate`, `hangup`
- **Real-time**: Uses Firestore `onSnapshot` for real-time updates

## Usage

### Starting a Call

**From Chat Screen:**
- Tap video icon for video call
- Tap phone icon for audio call

**Programmatically:**
```typescript
import { createCall } from '@/lib/services/callService';

const callId = await createCall(callerId, receiverId, 'video');
```

### During a Call

- **Mute/Unmute**: Tap mic icon
- **Video On/Off**: Tap video icon (video calls only)
- **Switch Camera**: Tap camera switch icon (video calls only)
- **End Call**: Tap red end call button

### Accepting/Rejecting Calls

- **Accept**: Tap green accept button
- **Reject**: Tap red reject button

## Firestore Structure

### Calls Collection
```
calls/{callId}
  - callerId: string
  - receiverId: string
  - type: 'audio' | 'video'
  - status: 'ringing' | 'active' | 'ended' | 'missed' | 'rejected'
  - createdAt: timestamp
  - endedAt?: timestamp
  - duration?: number (seconds)
```

### Signaling Subcollection
```
callSignaling/{callId}/messages/{messageId}
  - from: string (userId)
  - to: string (userId)
  - type: 'offer' | 'answer' | 'ice-candidate' | 'hangup'
  - sdp?: RTCSessionDescriptionInit
  - candidate?: RTCIceCandidateInit
  - timestamp: timestamp
```

## Security Rules

Your Firestore rules already support calls:
- ✅ Calls collection: Users can only access calls they're part of
- ✅ Signaling: Secured for call participants only

## Dependencies

- ✅ `react-native-webrtc`: Installed
- ✅ `@config-plugins/react-native-webrtc`: Already configured
- ✅ Firebase Firestore: For signaling
- ✅ Firebase Storage: For call media (if needed)

## Configuration

### app.json
Already configured with:
```json
{
  "plugins": [
    [
      "@config-plugins/react-native-webrtc",
      {
        "cameraPermission": "...",
        "microphonePermission": "..."
      }
    ]
  ]
}
```

### Permissions
- ✅ Camera permission (for video calls)
- ✅ Microphone permission (for audio/video calls)
- ✅ Already configured in `app.json`

## Testing

### Test Checklist
1. ✅ Start video call from chat
2. ✅ Start audio call from chat
3. ✅ Accept incoming call
4. ✅ Reject incoming call
5. ✅ Mute/unmute during call
6. ✅ Toggle video during call
7. ✅ Switch camera during call
8. ✅ End call
9. ✅ Verify call history

## Troubleshooting

### Call Not Connecting
- Check Firestore rules are published
- Verify both users are authenticated
- Check network connectivity
- Review console logs for WebRTC errors

### No Video/Audio
- Check camera/microphone permissions
- Verify media stream is being created
- Check WebRTC peer connection state

### Signaling Issues
- Verify Firestore rules allow signaling
- Check call document exists
- Verify user IDs match call participants

## Next Steps (Optional Enhancements)

1. **Call Notifications**: Push notifications for incoming calls
2. **Call Recording**: Record calls (with consent)
3. **Group Calls**: Multi-participant video calls
4. **Screen Sharing**: Share screen during calls
5. **Call Quality Indicators**: Show connection quality
6. **Call Timer**: Display call duration
7. **Call History UI**: Better call history display

## Notes

- Uses Google STUN servers (free tier)
- For production, consider TURN servers for NAT traversal
- Signaling is done via Firestore (real-time)
- All calls are peer-to-peer (no media server needed)

## Support

If you encounter issues:
1. Check browser/app console for errors
2. Verify Firestore rules are published
3. Check WebRTC permissions
4. Review network connectivity
5. Test with two devices/users


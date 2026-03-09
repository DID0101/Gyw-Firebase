# WebRTC Setup Instructions

## ⚠️ Important: Development Build Required

`react-native-webrtc` requires native code and **cannot run in Expo Go**. You need to create a development build.

## Quick Setup

### Step 1: Rebuild the App

Since `react-native-webrtc` requires native modules, you need to rebuild:

```bash
# For Android
npx expo prebuild --clean
npx expo run:android

# For iOS
npx expo prebuild --clean
npx expo run:ios
```

### Step 2: Verify Installation

The package is already installed:
- ✅ `react-native-webrtc`: ^124.0.7
- ✅ `@config-plugins/react-native-webrtc`: ^12.0.0

### Step 3: Configuration

The plugin is already configured in `app.json`:
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

## Current Status

The code has been updated with **conditional imports** to prevent bundling errors:
- ✅ WebRTC imports are wrapped in try-catch
- ✅ Graceful fallback if WebRTC is not available
- ✅ User-friendly error messages

## What Happens Now

### In Expo Go (Current)
- ❌ WebRTC won't work
- ✅ App won't crash
- ✅ Shows helpful error message
- ✅ Call buttons still visible but will show error

### After Rebuild
- ✅ WebRTC will work fully
- ✅ Video/audio calls will function
- ✅ All features enabled

## Testing

After rebuilding:

1. **Start a call** from chat screen
2. **Accept/reject** incoming calls
3. **Test controls**: mute, video toggle, camera switch
4. **End call** functionality

## Troubleshooting

### "react-native-webrtc not available"
- **Solution**: Rebuild the app (see Step 1 above)
- This is expected in Expo Go

### "Unable to resolve react-native-webrtc"
- **Solution**: Run `npm install` then rebuild
- Make sure you're using a development build, not Expo Go

### Calls not connecting
- Check Firestore rules are published
- Verify both users are authenticated
- Check network connectivity
- Review console logs

## Alternative: Use Expo Development Build

If you haven't created a dev build yet:

```bash
# Install EAS CLI (if not installed)
npm install -g eas-cli

# Login to Expo
eas login

# Create development build
eas build --profile development --platform android
# or
eas build --profile development --platform ios
```

Then install the build on your device and test WebRTC calls.

## Notes

- WebRTC requires native code compilation
- Cannot test in Expo Go (web-based)
- Must use development build or production build
- All code is ready, just needs rebuild


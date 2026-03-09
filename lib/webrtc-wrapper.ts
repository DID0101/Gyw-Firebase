// WebRTC wrapper to handle conditional imports
// This allows the app to work even if react-native-webrtc is not available (Expo Go)

let webrtcModule: any = null;
let isAvailable = false;

try {
  // Try to require the actual module
  webrtcModule = require('react-native-webrtc');
  // Check if it's the real module (has RTCView) or our polyfill
  if (webrtcModule && webrtcModule.RTCView && typeof webrtcModule.RTCView !== 'undefined' && webrtcModule.RTCView !== null) {
    isAvailable = true;
  } else {
    isAvailable = false;
  }
} catch (error: any) {
  // Module not available (Expo Go or not rebuilt)
  isAvailable = false;
  webrtcModule = {
    RTCView: null,
    RTCPeerConnection: null,
    RTCSessionDescription: null,
    RTCIceCandidate: null,
    MediaStream: null,
    mediaDevices: null,
  };
}

if (!isAvailable) {
  console.warn('react-native-webrtc not available. WebRTC features will be disabled.');
  console.warn('To enable WebRTC, rebuild the app with: npx expo prebuild --clean && npx expo run:android/ios');
}

export const RTCView = isAvailable ? webrtcModule?.RTCView : null;
export const RTCPeerConnection = isAvailable ? webrtcModule?.RTCPeerConnection : null;
export const RTCSessionDescription = isAvailable ? webrtcModule?.RTCSessionDescription : null;
export const RTCIceCandidate = isAvailable ? webrtcModule?.RTCIceCandidate : null;
export const MediaStream = isAvailable ? webrtcModule?.MediaStream : null;
export const mediaDevices = isAvailable ? webrtcModule?.mediaDevices : null;

export const isWebRTCAvailable = isAvailable;

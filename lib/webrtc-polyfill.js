// Polyfill for react-native-webrtc when not available (Expo Go)
// This prevents Metro bundler errors when the native module isn't available

module.exports = {
  RTCView: null,
  RTCPeerConnection: null,
  RTCSessionDescription: null,
  RTCIceCandidate: null,
  MediaStream: null,
  mediaDevices: null,
};


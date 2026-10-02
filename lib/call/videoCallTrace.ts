/** Structured video-call pipeline tracing (__DEV__ + productionTelemetry hooks). */

export type VideoCallTraceStage =
  | 'VIDEO_ACCEPT_START'
  | 'VIDEO_ACCEPT_NATIVE_COMPLETE'
  | 'VIDEO_CALL_SCREEN_MOUNT'
  | 'WEBRTC_INIT_START'
  | 'LOCAL_STREAM_CREATED'
  | 'REMOTE_STREAM_RECEIVED'
  | 'PC_CONNECTION_STATE'
  | 'ICE_CONNECTION_STATE'
  | 'REMOTE_DESCRIPTION_SET'
  | 'LOCAL_DESCRIPTION_SET'
  | 'VIDEO_TRACK_ATTACHED'
  | 'WEBRTC_OFFER_SENT'
  | 'WEBRTC_OFFER_RECEIVED'
  | 'WEBRTC_ANSWER_SENT'
  | 'WEBRTC_ANSWER_RECEIVED'
  | 'ICE_SENT'
  | 'ICE_RECEIVED'
  | 'REMOTE_VIDEO_RENDERED';

export function videoCallTrace(
  stage: VideoCallTraceStage,
  callId: string,
  detail?: Record<string, unknown>,
): void {
  const payload = { callId, ...detail };
  console.log(stage, payload);
}

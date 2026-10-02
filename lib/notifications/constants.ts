/**
 * Android notification channel IDs (must match native `GywIncomingCallNotifier.CHANNEL_ID`).
 */
export const CALL_ANDROID_CHANNEL_ID = 'incoming_calls_v3';

/** Must match {@code GywMessageNotifier.CHANNEL_ID} (chat only — never used for calls). */
export const CHAT_MESSAGES_ANDROID_CHANNEL_ID = 'chat_messages_v2';

/** Lower priority channel while a call is ringing ({@code GywMessageNotifier.CHANNEL_ID_QUIET}). */
export const CHAT_MESSAGES_QUIET_ANDROID_CHANNEL_ID = 'chat_messages_quiet';

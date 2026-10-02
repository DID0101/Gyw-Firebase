/** Dev-only structured logs for unread/read pipeline verification. */
export function logReadState(
  event:
    | 'MESSAGE_MARK_READ'
    | 'UNREAD_COUNT_UPDATED'
    | 'NOTIFICATION_REMOVED'
    | 'NOTIFICATION_POSTED'
    | 'CHATROOM_OPENED'
    | 'LAST_READ_TIMESTAMP_UPDATED',
  data: Record<string, unknown>
) {
  if (!__DEV__) return;
  console.log(`[ReadState] ${event}`, data);
}

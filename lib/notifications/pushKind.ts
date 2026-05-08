export const PUSH_DATA_TYPE_INCOMING_CALL = 'incoming_call';

export type IncomingCallPushData = {
  type?: string;
  callId?: string;
};

export function isIncomingCallPushData(data: Record<string, unknown> | null | undefined): data is IncomingCallPushData {
  if (!data) return false;
  const type = String(data.type ?? '');
  return type === PUSH_DATA_TYPE_INCOMING_CALL;
}

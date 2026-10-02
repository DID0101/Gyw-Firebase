import { resolveCallerDisplayName } from '@/lib/contacts/contactResolver';
import { ensureContactsHydratedForNotifications } from '@/store/contactsStore';

/** Sync resolve for hot paths — use FCM profile name when cache is cold. */
export function resolveIncomingCallPayloadNameSync(
  data: Record<string, string | undefined>,
): string {
  return (
    resolveCallerDisplayName({
      callerName: data.callerName ?? data.caller_name,
      callerPhone: data.callerPhone ?? data.caller_phone,
      logContext: 'fcm_incoming',
    }) ||
    data.callerName?.trim() ||
    data.caller_name?.trim() ||
    'Incoming call'
  );
}

/** Resolve incoming-call FCM / native payload display name (local contacts first). */
export async function resolveIncomingCallPayloadName(
  data: Record<string, string | undefined>
): Promise<string> {
  void ensureContactsHydratedForNotifications();
  return resolveIncomingCallPayloadNameSync(data);
}

/** Resolve chat-message push sender title. */
export async function resolveMessagePushSenderName(
  data: Record<string, string | undefined>
): Promise<string> {
  void ensureContactsHydratedForNotifications();
  return (
    resolveCallerDisplayName({
      callerName: data.senderName ?? data.sender_name ?? 'Message',
      callerPhone: data.senderPhone ?? data.sender_phone,
      logContext: 'fcm_chat',
    }) ||
    data.senderName?.trim() ||
    data.sender_name?.trim() ||
    'Message'
  );
}

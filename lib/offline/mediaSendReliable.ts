/**
 * Media send with MMKV upload queue on network failure — no data loss.
 */
import { BlockedPeerSendError } from '@/lib/chatSendGuards';
import { getNetworkState } from '@/lib/reliability/NetworkManager';
import { logUpload } from '@/lib/reliability/reliabilityLog';
import { captureReliabilityError } from '@/lib/reliability/SentryManager';
import { isNetworkError } from '@/lib/safeNetwork';
import {
  sendMediaMessage,
  type SendChatMessageOptions,
} from '@/lib/services/chatService';

import { enqueuePendingUpload, type PendingUploadPayload } from './uploadQueue';

export class MediaSendQueuedError extends Error {
  readonly code = 'media/queued';
  constructor(public readonly tempId: string) {
    super('Media queued — will send when connection returns');
    this.name = 'MediaSendQueuedError';
  }
}

function shouldQueueUpload(err: unknown): boolean {
  if (err instanceof BlockedPeerSendError) return false;
  if (!getNetworkState().isOnline) return true;
  return isNetworkError(err);
}

type MediaType = PendingUploadPayload['type'];

type ReplyTo = {
  messageId: string;
  senderName: string;
  text?: string;
  type?: string;
};

type ExtraData = PendingUploadPayload['extraData'];

/** Same signature as sendMediaMessage — queues to MMKV on network failure. */
export async function sendMediaMessageReliable(
  chatId: string,
  senderId: string,
  senderName: string,
  senderAvatar: string | undefined,
  fileUri: string,
  type: MediaType,
  fileName?: string,
  replyTo?: ReplyTo,
  extraData?: ExtraData,
  options?: SendChatMessageOptions,
  tempId?: string
): Promise<string> {
  try {
    return await sendMediaMessage(
      chatId,
      senderId,
      senderName,
      senderAvatar,
      fileUri,
      type,
      fileName,
      replyTo,
      extraData as Parameters<typeof sendMediaMessage>[8],
      options
    );
  } catch (err) {
    if (!shouldQueueUpload(err)) throw err;
    const id = tempId ?? `upload-pending-${Date.now()}`;
    await enqueuePendingUpload({
      tempId: id,
      chatId,
      senderId,
      senderName,
      senderAvatar,
      fileUri,
      type,
      fileName,
      extraData,
      replyTo,
      sendOptions: options,
    });
    captureReliabilityError('upload', err, { tempId: id, chatId, type });
    logUpload('QUEUED_FOR_RETRY', { tempId: id, chatId, type });
    throw new MediaSendQueuedError(id);
  }
}

export function isMediaSendQueuedError(err: unknown): err is MediaSendQueuedError {
  return err instanceof MediaSendQueuedError;
}

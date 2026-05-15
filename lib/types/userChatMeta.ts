/**
 * Per-user chat list preferences stored at users/{uid}/chatMeta/{chatId}.
 * Does not modify shared chat documents.
 */
export interface UserChatMeta {
  pinnedAt?: string | null;
  archived?: boolean;
  muted?: boolean;
  mutedUntil?: string | null;
  deletedAt?: string | null;
}

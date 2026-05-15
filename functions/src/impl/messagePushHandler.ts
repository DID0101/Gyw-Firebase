import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";
import { getDb } from "./adminApp";

type ChatDoc = {
  participants?: string[];
  unreadCount?: Record<string, number>;
};

type ChatMessageDoc = {
  senderId?: string;
  senderName?: string;
  senderAvatar?: string;
  text?: string;
  type?: string;
  createdAt?: admin.firestore.Timestamp | string;
};

type UserTokenDoc = {
  fcmToken?: string;
};

function toMillis(v: ChatMessageDoc["createdAt"]): number {
  if (!v) return Date.now();
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  try {
    return v.toMillis();
  } catch {
    return Date.now();
  }
}

function previewText(msg: ChatMessageDoc): string {
  if (msg.text && msg.text.trim()) return msg.text.trim().slice(0, 240);
  switch (msg.type) {
    case "image":
      return "Photo";
    case "video":
      return "Video";
    case "audio":
      return "Voice message";
    case "file":
      return "Attachment";
    case "document":
      return "Document";
    case "location":
      return "Location";
    default:
      return "New message";
  }
}

export async function handleChatMessageCreated(
  chatId: string,
  messageId: string,
  messageData: admin.firestore.DocumentData
): Promise<void> {
  const msg = messageData as ChatMessageDoc;
  const senderId = msg.senderId ?? "";
  if (!senderId) {
    functions.logger.warn("[messagePush] skip: missing senderId", { chatId, messageId });
    return;
  }
  if (msg.type === "call") {
    functions.logger.info("[messagePush] skip call log message", { chatId, messageId });
    return;
  }
  if (msg.type === "system") {
    functions.logger.info("[messagePush] skip system message", { chatId, messageId });
    return;
  }

  const db = getDb();
  const chatSnap = await db.collection("chats").doc(chatId).get();
  if (!chatSnap.exists) {
    functions.logger.warn("[messagePush] chat not found", { chatId, messageId });
    return;
  }
  const chat = (chatSnap.data() ?? {}) as ChatDoc;
  const participants = Array.isArray(chat.participants) ? chat.participants : [];
  const targets = participants.filter((uid) => uid && uid !== senderId);
  if (targets.length === 0) return;

  const metaRefs = targets.map((receiverId) =>
    db.collection("users").doc(receiverId).collection("chatMeta").doc(chatId)
  );
  const prefRefs = targets.map((receiverId) =>
    db.collection("users").doc(receiverId).collection("chatPreferences").doc(chatId)
  );
  const blockRefs = targets.map((receiverId) =>
    db.collection("users").doc(receiverId).collection("blockedUsers").doc(senderId)
  );
  const allRefs = [...metaRefs, ...prefRefs, ...blockRefs];
  const allSnaps = allRefs.length > 0 ? await db.getAll(...allRefs) : [];
  const n = targets.length;
  const mutedByReceiver = new Map<string, boolean>();
  const blockedSenderByReceiver = new Map<string, boolean>();
  targets.forEach((receiverId, i) => {
    const metaSnap = allSnaps[i];
    const prefSnap = allSnaps[n + i];
    const blockSnap = allSnaps[2 * n + i];
    const metaMuted = metaSnap?.exists === true && metaSnap.data()?.muted === true;
    const prefMuted = prefSnap?.exists === true && prefSnap.data()?.muted === true;
    mutedByReceiver.set(receiverId, !!(metaMuted || prefMuted));
    const blocked =
      blockSnap?.exists === true && (blockSnap.data() as { blocked?: boolean })?.blocked === true;
    blockedSenderByReceiver.set(receiverId, !!blocked);
  });

  const senderName = msg.senderName?.trim() || "Message";
  const text = previewText(msg);
  const avatar = msg.senderAvatar ?? "";
  const sentAt = String(toMillis(msg.createdAt));

  await Promise.all(
    targets.map(async (receiverId) => {
      if (mutedByReceiver.get(receiverId)) {
        functions.logger.info("[messagePush] skip muted chat for receiver", { chatId, receiverId });
        return;
      }
      if (blockedSenderByReceiver.get(receiverId)) {
        functions.logger.info("[messagePush] skip push — sender blocked by receiver", {
          chatId,
          receiverId,
          senderId,
        });
        return;
      }
      const unreadCount = chat.unreadCount?.[receiverId] ?? 1;
      const tokenSnap = await db.collection("userTokens").doc(receiverId).get();
      if (!tokenSnap.exists) return;
      const { fcmToken } = (tokenSnap.data() ?? {}) as UserTokenDoc;
      if (!fcmToken) return;

      const message: admin.messaging.Message = {
        token: fcmToken,
        data: {
          type: "chat_message",
          chatId,
          senderId,
          senderName,
          text,
          messageId,
          avatar,
          sentAt,
          unreadCount: String(unreadCount),
        },
        android: {
          priority: "high",
          ttl: 3600 * 1000,
        },
      };
      console.log("MSG_FCM_PAYLOAD:", JSON.stringify(message));
      try {
        const id = await admin.messaging().send(message);
        functions.logger.info("[messagePush] sent", { messageId: id, chatId, receiverId });
      } catch (err: any) {
        functions.logger.error("[messagePush] send error", {
          chatId,
          receiverId,
          error: err?.message,
        });
        if (err?.errorInfo?.code === "messaging/registration-token-not-registered") {
          await db
            .collection("userTokens")
            .doc(receiverId)
            .update({ fcmToken: admin.firestore.FieldValue.delete() });
        }
      }
    })
  );
}

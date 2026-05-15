import { randomUUID } from "crypto";
import * as functionsV1 from "firebase-functions/v1";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminApp, getDb } from "../adminApp";
import { DEFAULT_RATE_LIMIT_PER_MINUTE, GYW_AI_DISPLAY_NAME, GYW_AI_SYSTEM_ID } from "./constants";
import { enforcePerUserRateLimit } from "./rateLimit";
import { resolveGeminiApiKey, classifyGeminiError } from "./handler";
import type { AiMultimodalMode } from "./aiRoute";
import { inferMultimodalRoute } from "./aiRoute";
import {
  downloadImageAsBase64,
  generateGeminiVisionCaption,
  tryGeminiImageGeneration,
} from "./geminiMultimodal";

type CallableRequest = {
  auth?: { uid: string } | null;
  data?: any;
};

function parseAiMode(raw: unknown): AiMultimodalMode {
  if (raw === "vision" || raw === "image_gen" || raw === "auto") return raw;
  return "auto";
}

/** Bucket ids to try (new + legacy default bucket names). */
function storageBucketCandidates(): string[] {
  const fromEnv = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  const pid = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  const ordered = [
    fromEnv,
    pid ? `${pid}.firebasestorage.app` : "",
    pid ? `${pid}.appspot.com` : "",
  ].filter(Boolean) as string[];
  return [...new Set(ordered)];
}

/**
 * Save PNG and return a Firebase-style download URL using a download token
 * (avoids getSignedUrl / IAM signBlob issues that surface as INTERNAL on some projects).
 */
async function saveAiGeneratedPngAndGetUrl(params: {
  png: Buffer;
  chatId: string;
  userMessageId: string;
}): Promise<string> {
  const admin = getAdminApp();
  const objectPath = `chats/${params.chatId}/ai-generated/${params.userMessageId}-${Date.now()}.png`;
  const token = randomUUID();
  const candidates = storageBucketCandidates();

  const trySave = async (bucketName: string | null) => {
    const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
    const file = bucket.file(objectPath);
    await file.save(params.png, {
      resumable: false,
      metadata: {
        contentType: "image/png",
        cacheControl: "public,max-age=31536000",
        metadata: {
          firebaseStorageDownloadTokens: token,
        },
      },
    });
    const encPath = encodeURIComponent(objectPath);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encPath}?alt=media&token=${token}`;
  };

  let lastErr: unknown = null;
  for (const name of candidates) {
    try {
      return await trySave(name);
    } catch (e) {
      lastErr = e;
      functionsV1.logger.warn("[gywAiMultimodal] bucket save attempt failed", {
        bucket: name,
        err: String((e as any)?.message ?? e),
      });
    }
  }
  try {
    return await trySave(null);
  } catch (e) {
    lastErr = e;
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function handleGywAiMultimodal(request: CallableRequest): Promise<{
  ok: true;
  messageId: string;
  kind: "text" | "image";
  text?: string;
  imageUrl?: string;
}> {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new functionsV1.https.HttpsError("unauthenticated", "Must be signed in");
  }

  const chatId = typeof request.data?.chatId === "string" ? request.data.chatId : "";
  const userMessageId = typeof request.data?.userMessageId === "string" ? request.data.userMessageId : "";

  if (!chatId || !userMessageId) {
    throw new functionsV1.https.HttpsError("invalid-argument", "chatId and userMessageId are required");
  }

  const geminiKey = resolveGeminiApiKey();
  if (!geminiKey) {
    throw new functionsV1.https.HttpsError(
      "failed-precondition",
      "Missing Gemini API key: set env GEMINI_API_KEY (or functions config gyw.gemini_api_key) and redeploy."
    );
  }

  const db = getDb();
  await enforcePerUserRateLimit({
    db,
    uid,
    limitPerMinute: DEFAULT_RATE_LIMIT_PER_MINUTE,
  });

  const chatRef = db.collection("chats").doc(chatId);
  const chatSnap = await chatRef.get();
  if (!chatSnap.exists) {
    throw new functionsV1.https.HttpsError("not-found", "Chat not found");
  }
  const chat = chatSnap.data() || {};
  const participants: string[] = Array.isArray(chat.participants) ? chat.participants : [];
  if (!participants.includes(uid)) {
    throw new functionsV1.https.HttpsError("permission-denied", "Not a participant");
  }
  if (!participants.includes(GYW_AI_SYSTEM_ID)) {
    throw new functionsV1.https.HttpsError("failed-precondition", "This chat is not a Gyw AI chat");
  }

  const msgRef = chatRef.collection("messages").doc(userMessageId);
  const msgSnap = await msgRef.get();
  if (!msgSnap.exists) {
    throw new functionsV1.https.HttpsError("not-found", "Message not found");
  }
  const msg = msgSnap.data() as Record<string, any>;
  if (String(msg.senderId) !== uid) {
    throw new functionsV1.https.HttpsError("permission-denied", "Not your message");
  }
  if (String(msg.type) !== "image" || !msg.imageUrl) {
    throw new functionsV1.https.HttpsError("invalid-argument", "Message must be an image with imageUrl");
  }

  const imageUrl = String(msg.imageUrl);
  const userCaption = typeof msg.text === "string" ? msg.text.trim() : "";
  const explicitMode = parseAiMode(msg.aiMode);
  const route = inferMultimodalRoute(userCaption, explicitMode);

  const typingField = `typing.${GYW_AI_SYSTEM_ID}`;
  await chatRef.set(
    {
      [typingField]: { at: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const messagesRef = chatRef.collection("messages");
  const nowIso = new Date().toISOString();

  try {
    const { mimeType, base64 } = await downloadImageAsBase64(imageUrl);

    if (route === "image_gen") {
      let png: Buffer | null = null;
      try {
        png = await tryGeminiImageGeneration({
          geminiApiKey: geminiKey,
          imageMime: mimeType,
          imageBase64: base64,
          prompt: userCaption,
        });
      } catch (e) {
        functionsV1.logger.warn("[gywAiMultimodal] image gen threw", e);
      }

      if (png && png.length > 0 && png.length < 12 * 1024 * 1024) {
        let imagePublicUrl: string;
        try {
          imagePublicUrl = await saveAiGeneratedPngAndGetUrl({
            png,
            chatId,
            userMessageId,
          });
        } catch (storageErr: any) {
          functionsV1.logger.error("[gywAiMultimodal] storage save failed", {
            message: storageErr?.message,
            code: storageErr?.code,
          });
          throw new functionsV1.https.HttpsError(
            "failed-precondition",
            "Could not store the generated image. Check Cloud Storage bucket permissions and FIREBASE_STORAGE_BUCKET.",
            { detail: String(storageErr?.message ?? storageErr) }
          );
        }

        const caption = userCaption
          ? `Generated from your request: ${userCaption.substring(0, 200)}`
          : "Here is an edited image.";

        const aiDoc = await messagesRef.add({
          chatId,
          senderId: GYW_AI_SYSTEM_ID,
          senderName: GYW_AI_DISPLAY_NAME,
          senderAvatar: null,
          isAI: true,
          type: "image",
          imageUrl: imagePublicUrl,
          text: caption,
          readBy: [GYW_AI_SYSTEM_ID],
          status: "sent",
          sentAt: nowIso,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          aiMultimodalRoute: "image_gen",
          aiMultimodalSourceMessageId: userMessageId,
        });

        await chatRef.set(
          {
            lastMessage: {
              text: "📷 AI image",
              senderId: GYW_AI_SYSTEM_ID,
              createdAt: nowIso,
              type: "image",
            },
            lastMessageAt: FieldValue.serverTimestamp(),
            lastSenderId: GYW_AI_SYSTEM_ID,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return { ok: true, messageId: aiDoc.id, kind: "image", imageUrl: imagePublicUrl, text: caption };
      }

      // Image models returned no pixels — do NOT run vision with a "can't edit" style prompt.
      const explain =
        "Gyw AI could not produce an edited image (the image model returned no image data). " +
        "Tap Retry, choose Create / edit when sending the photo, try a shorter prompt, or confirm your Gemini API key has access to image-capable models (e.g. gemini-2.5-flash-image or gemini-3.1-flash-image-preview).";

      functionsV1.logger.error("[gywAiMultimodal] image_gen produced no image buffer", {
        chatId,
        userMessageId,
        captionLen: userCaption.length,
      });

      const aiDoc = await messagesRef.add({
        chatId,
        senderId: GYW_AI_SYSTEM_ID,
        senderName: GYW_AI_DISPLAY_NAME,
        senderAvatar: null,
        isAI: true,
        type: "text",
        text: explain,
        readBy: [GYW_AI_SYSTEM_ID],
        status: "sent",
        sentAt: nowIso,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        aiMultimodalRoute: "image_gen_failed",
        aiMultimodalSourceMessageId: userMessageId,
      });

      await chatRef.set(
        {
          lastMessage: {
            text: explain.substring(0, 100),
            senderId: GYW_AI_SYSTEM_ID,
            createdAt: nowIso,
            type: "text",
          },
          lastMessageAt: FieldValue.serverTimestamp(),
          lastSenderId: GYW_AI_SYSTEM_ID,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { ok: true, messageId: aiDoc.id, kind: "text", text: explain };
    }

    // vision
    let replyText: string;
    try {
      replyText = await generateGeminiVisionCaption({
        geminiApiKey: geminiKey,
        imageMime: mimeType,
        imageBase64: base64,
        userPrompt: userCaption,
      });
    } catch (e: any) {
      const diag = classifyGeminiError(e);
      functionsV1.logger.error("[gywAiMultimodal] vision failed", { diag });
      throw new functionsV1.https.HttpsError(
        "unavailable",
        "Gyw AI could not analyze this image. Please try again.",
        { reason: diag.reason }
      );
    }

    const aiDoc = await messagesRef.add({
      chatId,
      senderId: GYW_AI_SYSTEM_ID,
      senderName: GYW_AI_DISPLAY_NAME,
      senderAvatar: null,
      isAI: true,
      type: "text",
      text: replyText,
      readBy: [GYW_AI_SYSTEM_ID],
      status: "sent",
      sentAt: nowIso,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      aiMultimodalRoute: "vision",
      aiMultimodalSourceMessageId: userMessageId,
    });

    await chatRef.set(
      {
        lastMessage: {
          text: replyText.substring(0, 100),
          senderId: GYW_AI_SYSTEM_ID,
          createdAt: nowIso,
          type: "text",
        },
        lastMessageAt: FieldValue.serverTimestamp(),
        lastSenderId: GYW_AI_SYSTEM_ID,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true, messageId: aiDoc.id, kind: "text", text: replyText };
  } catch (e: any) {
    if (e instanceof functionsV1.https.HttpsError) throw e;
    functionsV1.logger.error("[gywAiMultimodal] unhandled error", {
      message: e?.message,
      stack: e?.stack,
      name: e?.name,
    });
    throw new functionsV1.https.HttpsError(
      "unavailable",
      "Gyw AI could not complete this image request. Please try again.",
      { detail: String(e?.message ?? e) }
    );
  } finally {
    try {
      await chatRef.set(
        {
          [typingField]: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (clearErr) {
      functionsV1.logger.warn("[gywAiMultimodal] typing indicator clear failed", clearErr);
    }
  }
}

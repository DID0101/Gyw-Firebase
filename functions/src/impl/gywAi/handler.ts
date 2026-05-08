import * as functionsV1 from "firebase-functions/v1";

type AiKeySource =
  | "env:GEMINI_API_KEY"
  | "env:CLOUD_RUNTIME_CONFIG.gyw.gemini_api_key"
  | "functions/v1.config().gyw.gemini_api_key"
  | "functions.config().gyw.gemini_api_key"
  | "missing";

let keySourceLogged = false;

function resolveOneKey(provider: "gemini"): { key: string; source: AiKeySource } {
  const fromGeminiEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromGeminiEnv) return { key: fromGeminiEnv, source: "env:GEMINI_API_KEY" };

  try {
    const raw = process.env.CLOUD_RUNTIME_CONFIG;
    if (raw) {
      const parsed = JSON.parse(raw) as { gyw?: { gemini_api_key?: string } };
      const v = parsed?.gyw?.gemini_api_key?.trim();
      if (v) return { key: v, source: "env:CLOUD_RUNTIME_CONFIG.gyw.gemini_api_key" };
    }
  } catch {
    /* ignore malformed runtime config env */
  }

  try {
    const fnV1 = require("firebase-functions/v1") as {
      config?: () => { gyw?: { gemini_api_key?: string } };
    };
    const v = fnV1.config?.()?.gyw?.gemini_api_key?.trim();
    if (v) return { key: v, source: "functions/v1.config().gyw.gemini_api_key" };
  } catch {
    /* continue to legacy fallback */
  }

  try {
    const fn = require("firebase-functions") as {
      config?: () => { gyw?: { gemini_api_key?: string } };
    };
    const v = fn.config?.()?.gyw?.gemini_api_key?.trim();
    if (v) return { key: v, source: "functions.config().gyw.gemini_api_key" };
  } catch {
    /* no config (e.g. tests) */
  }

  return { key: "", source: "missing" };
}

function resolveAiApiKeysWithSources(): {
  geminiKey: string;
  geminiSource: AiKeySource;
} {
  const gemini = resolveOneKey("gemini");
  return {
    geminiKey: gemini.key,
    geminiSource: gemini.source,
  };
}

function resolveAiApiKeyWithSource(): { key: string; source: AiKeySource } {
  const all = resolveAiApiKeysWithSources();
  if (all.geminiKey) return { key: all.geminiKey, source: all.geminiSource };
  return { key: "", source: "missing" };
}

export function resolveGeminiApiKey(): string {
  return resolveAiApiKeyWithSource().key;
}
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "../adminApp";
import {
  DEFAULT_CONTEXT_MESSAGE_LIMIT,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  GYW_AI_DISPLAY_NAME,
  GYW_AI_SYSTEM_ID,
} from "./constants";
import { sanitizeUserText } from "./sanitize";
import { enforcePerUserRateLimit } from "./rateLimit";
import { generateGywAiReply } from "./gemini";

type CallableRequest = {
  auth?: { uid: string } | null;
  data?: any;
};

function classifyGeminiError(e: any): { reason: string; status?: number; message: string } {
  const status = typeof e?.status === "number" ? e.status : undefined;
  const message = e?.message ? String(e.message) : String(e);
  const m = message.toLowerCase();

  // Check HTTP status codes first (authoritative), then fall back to message heuristics.
  if (status === 401) return { reason: "API_KEY_OR_PERMISSION", status, message };
  if (status === 403) return { reason: "BILLING_OR_PERMISSION", status, message };
  if (status === 404) return { reason: "MODEL_NOT_AVAILABLE", status, message };
  if (status === 429) return { reason: "QUOTA_OR_RATE_LIMIT", status, message };

  // No numeric status — classify by message content.
  if (m.includes("unauth") || m.includes("api key")) {
    return { reason: "API_KEY_OR_PERMISSION", status, message };
  }
  if (m.includes("billing") || m.includes("permission denied")) {
    return { reason: "BILLING_OR_PERMISSION", status, message };
  }
  if (m.includes("not found") || m.includes("listmodels") || m.includes("model not found") || m.includes("no such model")) {
    return { reason: "MODEL_NOT_AVAILABLE", status, message };
  }
  if (m.includes("quota") || m.includes("rate limit") || m.includes("resource exhausted")) {
    return { reason: "QUOTA_OR_RATE_LIMIT", status, message };
  }
  if (m.includes("timed out") || m.includes("timeout") || m.includes("deadline")) {
    return { reason: "UPSTREAM_TIMEOUT", status, message };
  }
  return { reason: "UPSTREAM_ERROR", status, message };
}

export async function handleGywAiReply(request: CallableRequest): Promise<{
  ok: true;
  messageId: string;
  text: string;
}> {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new functionsV1.https.HttpsError("unauthenticated", "Must be signed in");
  }

  const chatId = typeof request.data?.chatId === "string" ? request.data.chatId : "";
  const userText = sanitizeUserText(request.data?.text, 2000);
  const contextLimit =
    typeof request.data?.contextLimit === "number" && request.data.contextLimit > 0
      ? Math.min(50, Math.floor(request.data.contextLimit))
      : DEFAULT_CONTEXT_MESSAGE_LIMIT;

  if (!chatId) {
    throw new functionsV1.https.HttpsError("invalid-argument", "chatId is required");
  }
  if (!userText) {
    throw new functionsV1.https.HttpsError("invalid-argument", "text is required");
  }

  const resolved = resolveAiApiKeysWithSources();
  if (!keySourceLogged) {
    keySourceLogged = true;
    functionsV1.logger.info("[gywAiReply] AI key sources resolved", {
      geminiKeySource: resolved.geminiSource,
      geminiHasKey: !!resolved.geminiKey,
    });
  }
  if (!resolved.geminiKey) {
    throw new functionsV1.https.HttpsError(
      "failed-precondition",
      "Missing Gemini API key: set env GEMINI_API_KEY (or functions config gyw.gemini_api_key) and redeploy."
    );
  }

  const db = getDb();

  // Abuse protection.
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

  // Ensure caller is a participant and that this is an AI direct chat.
  if (!participants.includes(uid)) {
    throw new functionsV1.https.HttpsError("permission-denied", "Not a participant");
  }
  if (!participants.includes(GYW_AI_SYSTEM_ID)) {
    throw new functionsV1.https.HttpsError("failed-precondition", "This chat is not a Gyw AI chat");
  }

  const typingField = `typing.${GYW_AI_SYSTEM_ID}`;
  const messagesRef = chatRef.collection("messages");

  // Set "Gyw AI is typing…" in the existing chat UI (server-side).
  await chatRef.set(
    {
      [typingField]: { at: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    // Fetch last N messages for windowed context.
    const historySnap = await messagesRef.orderBy("createdAt", "desc").limit(contextLimit).get();
    const docs = historySnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    // Oldest → newest.
    const chronological = docs
      .filter((m) => m && typeof m.text === "string" && m.text.trim())
      .reverse();

    const history = chronological.map((m) => {
      const senderId = String(m.senderId || "");
      const role = senderId === GYW_AI_SYSTEM_ID ? ("model" as const) : ("user" as const);
      return { role, parts: [{ text: String(m.text) }] };
    });

    let replyText: string;
    try {
      replyText = await generateGywAiReply({
        geminiApiKey: resolved.geminiKey || undefined,
        history,
        userText,
      });
    } catch (e: any) {
      // Convert provider errors into a stable callable error (avoid generic INTERNAL on client).
      const diag = classifyGeminiError(e);
      functionsV1.logger.error("[gywAiReply] Gemini call failed", {
        chatId,
        uid,
        reason: diag.reason,
        message: diag.message,
        name: e?.name,
        status: diag.status,
        statusText: e?.statusText,
      });
      throw new functionsV1.https.HttpsError(
        "unavailable",
        "Gyw AI is temporarily unavailable. Please try again.",
        { reason: diag.reason, status: diag.status }
      );
    }

    if (!replyText) {
      throw new functionsV1.https.HttpsError("internal", "Empty AI response");
    }

    const nowIso = new Date().toISOString();

    // Persist AI reply as a normal message inside the same messages subcollection.
    const msgRef = await messagesRef.add({
      chatId,
      senderId: GYW_AI_SYSTEM_ID,
      senderName: GYW_AI_DISPLAY_NAME,
      senderAvatar: null,
      isAI: true,
      text: replyText,
      type: "text",
      readBy: [GYW_AI_SYSTEM_ID],
      status: "sent",
      sentAt: nowIso,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Update chat preview for list ordering.
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

    return { ok: true, messageId: msgRef.id, text: replyText };
  } finally {
    // Always clear typing indicator.
    await chatRef.set(
      {
        [typingField]: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}


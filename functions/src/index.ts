/**
 * Firebase Cloud Functions — thin entry so CLI discovery stays under the default timeout.
 * Implementations live in `impl/handlers.ts` (required only when a trigger runs).
 *
 * Do NOT import firebase-admin here — it makes CLI code analysis exceed the default 10s timeout.
 * Admin initializes when `impl/adminApp` loads (first `require("./impl/handlers")`).
 *
 * Discovery default is 10s. From `functions/`: `npm run deploy` sets FUNCTIONS_DISCOVERY_TIMEOUT=120.
 * PowerShell: `$env:FUNCTIONS_DISCOVERY_TIMEOUT='120'; firebase deploy --only functions`
 */
import * as functions from "firebase-functions/v1";

// ── callPush (Firestore onCreate calls/{callId}) ─────────────────────────────
// Explicitly export callPush so production always maps this trigger to the
// current repo handler (impl/callPushHandler.ts), replacing legacy ghost code.
export const callPush = functions
  .region("us-central1")
  .firestore.document("calls/{callId}")
  .onCreate(async (snap, context) => {
    const { handleCallCreated } = require("./impl/callPushHandler") as typeof import("./impl/callPushHandler");
    return handleCallCreated(context.params.callId, snap.data());
  });

// ── messagePush (Firestore onCreate chats/{chatId}/messages/{messageId}) ─────
// Dedicated chat message sender. Data-only + high-priority payload with type=chat_message.
// Completely separate from callPush / incoming_call transport.
export const messagePush = functions
  .region("us-central1")
  .firestore.document("chats/{chatId}/messages/{messageId}")
  .onCreate(async (snap, context) => {
    const { handleChatMessageCreated } = require("./impl/messagePushHandler") as typeof import("./impl/messagePushHandler");
    return handleChatMessageCreated(
      context.params.chatId,
      context.params.messageId,
      snap.data()
    );
  });

export const markStaleRingingCallsMissed = functions
  .region("us-central1")
  .pubsub.schedule("every 2 minutes")
  .timeZone("Etc/UTC")
  .onRun(async () => {
    const { handleMarkStaleRingingCallsMissed } = require("./impl/handlers") as typeof import("./impl/handlers");
    return handleMarkStaleRingingCallsMissed();
  });

// ── onCallTerminal — writes callHistory for both parties ─────────────────────
export const onCallTerminal = functions
  .region("us-central1")
  .firestore.document("calls/{callId}")
  .onUpdate(async (change, context) => {
    const { handleOnCallTerminal } = require("./impl/callCleanup") as typeof import("./impl/callCleanup");
    return handleOnCallTerminal(change, context);
  });

// ── deleteStaleCallDocs — hard-delete calls past their TTL ───────────────────
export const deleteStaleCallDocs = functions
  .region("us-central1")
  .pubsub.schedule("every 24 hours")
  .timeZone("Etc/UTC")
  .onRun(async () => {
    const { handleDeleteStaleCallDocs } = require("./impl/callCleanup") as typeof import("./impl/callCleanup");
    return handleDeleteStaleCallDocs();
  });

// ── deleteStaleDeviceTokens — prune 30-day-inactive device token records ──────
export const deleteStaleDeviceTokens = functions
  .region("us-central1")
  .pubsub.schedule("every 24 hours")
  .timeZone("Etc/UTC")
  .onRun(async () => {
    const { handleDeleteStaleDeviceTokens } = require("./impl/callCleanup") as typeof import("./impl/callCleanup");
    return handleDeleteStaleDeviceTokens();
  });

export const tryRandomMatch = functions.region("us-central1").https.onCall(async (data, context) => {
  const { handleTryRandomMatch } = require("./impl/handlers") as typeof import("./impl/handlers");
  return handleTryRandomMatch(data, context);
});

export const checkSkipRateLimit = functions.https.onCall(async (data, context) => {
  const { handleCheckSkipRateLimit } = require("./impl/handlers") as typeof import("./impl/handlers");
  return handleCheckSkipRateLimit(data, context);
});

export const checkAndBanFromReports = functions.pubsub.schedule("every 1 hours").onRun(async () => {
  const { handleCheckAndBanFromReports } = require("./impl/handlers") as typeof import("./impl/handlers");
  return handleCheckAndBanFromReports();
});

export const cleanupRandomQueue = functions.pubsub.schedule("every 1 minutes").onRun(async () => {
  const { handleCleanupRandomQueue } = require("./impl/handlers") as typeof import("./impl/handlers");
  return handleCleanupRandomQueue();
});

// ── Reject from lock screen (no auth token available on device) ───────────────
// Called by IncomingCallReceiver.kt (Android) and GywVoIPPushDelegate.swift (iOS)
// when the user rejects the call from the lock screen / notification.
export const rejectCallAnon = functions
  .region("us-central1")
  .https.onCall(async (data, context) => {
    const { handleRejectCallAnon } = require("./impl/callPushHandler") as typeof import("./impl/callPushHandler");
    return handleRejectCallAnon(data, context);
  });

// ── initiateCall / endCall ────────────────────────────────────────────────────
export const initiateCall = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onCall(async (data, context) => {
    const { handleInitiateCall } = require("./impl/initiateCallHandler") as typeof import("./impl/initiateCallHandler");
    return handleInitiateCall(data, context);
  });

export const endCall = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 15, memory: "256MB" })
  .https.onCall(async (data, context) => {
    const { handleEndCall } = require("./impl/initiateCallHandler") as typeof import("./impl/initiateCallHandler");
    return handleEndCall(data, context);
  });

export const transitionCallState = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 15, memory: "256MB" })
  .https.onCall(async (data, context) => {
    const { handleTransitionCallState } = require("./impl/initiateCallHandler") as typeof import("./impl/initiateCallHandler");
    return handleTransitionCallState(data, context);
  });

// ── Gyw AI: v1 callables (Spark-friendly; avoids v2 Cloud Run / Eventarc + Secret Manager deploy path) ──
// Callable names differ from legacy gen2 `gywAiReply` / `gywAiHealth` if those still exist in GCP without billing to delete them.
// Set key: `firebase functions:config:set gyw.gemini_api_key="..."` or runtime env GEMINI_API_KEY on these functions.
export const gywAiReplyV1 = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 180, memory: "512MB" })
  .https.onCall(async (data, context) => {
    const { handleGywAiReply } = require("./impl/gywAi/handler") as typeof import("./impl/gywAi/handler");
    return handleGywAiReply({
      auth: context.auth ? { uid: context.auth.uid } : null,
      data,
    });
  });

export const gywAiMultimodalV1 = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 300, memory: "1GB" })
  .https.onCall(async (data, context) => {
    const { handleGywAiMultimodal } = require("./impl/gywAi/multimodalHandler") as typeof import("./impl/gywAi/multimodalHandler");
    return handleGywAiMultimodal({
      auth: context.auth ? { uid: context.auth.uid } : null,
      data,
    });
  });

export const removeGroupMember = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 20, memory: "256MB" })
  .https.onCall(async (data, context) => {
    const { handleRemoveGroupMember } = require("./impl/removeGroupMember") as typeof import("./impl/removeGroupMember");
    return handleRemoveGroupMember(data, context);
  });

export const createGroupV1 = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 25, memory: "256MB" })
  .https.onCall(async (data, context) => {
    const { handleCreateGroup } = require("./impl/groupCallables") as typeof import("./impl/groupCallables");
    return handleCreateGroup(data, context);
  });

export const leaveGroupV1 = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 20, memory: "256MB" })
  .https.onCall(async (data, context) => {
    const { handleLeaveGroup } = require("./impl/groupCallables") as typeof import("./impl/groupCallables");
    return handleLeaveGroup(data, context);
  });

export const addGroupMembersV1 = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 25, memory: "256MB" })
  .https.onCall(async (data, context) => {
    const { handleAddGroupMembers } = require("./impl/groupCallables") as typeof import("./impl/groupCallables");
    return handleAddGroupMembers(data, context);
  });

export const updateGroupInfoV1 = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 20, memory: "256MB" })
  .https.onCall(async (data, context) => {
    const { handleUpdateGroupInfo } = require("./impl/groupCallables") as typeof import("./impl/groupCallables");
    return handleUpdateGroupInfo(data, context);
  });

export const gywAiHealthV1 = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 10, memory: "128MB" })
  .https.onCall(async (_data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError("unauthenticated", "Must be signed in");
    }
    const { resolveGeminiApiKey } = require("./impl/gywAi/handler") as typeof import("./impl/gywAi/handler");
    const hasKey = !!resolveGeminiApiKey();
    return { ok: true, hasKey };
  });

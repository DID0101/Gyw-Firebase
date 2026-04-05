/**
 * Firebase Cloud Functions — thin entry so CLI discovery stays under the default timeout.
 * Implementations live in `impl/handlers.ts` (required only when a trigger runs).
 *
 * Do NOT import firebase-admin here — it makes CLI code analysis exceed the default 10s timeout.
 * Admin initializes when `impl/adminApp` loads (first `require("./impl/handlers")`).
 *
 * PowerShell (if discovery still times out): `$env:FUNCTIONS_DISCOVERY_TIMEOUT='120'; firebase deploy --only functions`
 * Partial deploy (firebase.json has codebase `default`): `--only functions:default:onCallCreated` not `functions:onCallCreated`.
 */
import * as functions from "firebase-functions/v1";

export const onCallCreated = functions
  .region("us-central1")
  .firestore.document("calls/{callId}")
  .onCreate(async (snap, context) => {
    const { handleOnCallCreated } = require("./impl/handlers") as typeof import("./impl/handlers");
    return handleOnCallCreated(snap, context);
  });

export const onCallUpdated = functions
  .region("us-central1")
  .firestore.document("calls/{callId}")
  .onUpdate(async (change, context) => {
    const { handleOnCallUpdated } = require("./impl/handlers") as typeof import("./impl/handlers");
    return handleOnCallUpdated(change, context);
  });

export const markStaleRingingCallsMissed = functions
  .region("us-central1")
  .pubsub.schedule("every 2 minutes")
  .timeZone("Etc/UTC")
  .onRun(async () => {
    const { handleMarkStaleRingingCallsMissed } = require("./impl/handlers") as typeof import("./impl/handlers");
    return handleMarkStaleRingingCallsMissed();
  });

/** Proactive FCM registration cleanup + dry-run validation (see `fcmTokenMaintenance.ts`). */
export const fcmTokenMaintenanceSweep = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .pubsub.schedule("every day 05:00")
  .timeZone("Etc/UTC")
  .onRun(async () => {
    const { handleFcmTokenMaintenanceScheduled } = require("./impl/handlers") as typeof import("./impl/handlers");
    return handleFcmTokenMaintenanceScheduled();
  });

/** Remove fcmTokens subdocs with updatedAt/lastActiveAt older than 60d or unusable token length. */
export const cleanupStaleTokens = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .pubsub.schedule("every 24 hours")
  .timeZone("Etc/UTC")
  .onRun(async () => {
    const { handleCleanupStaleTokens } = require("./impl/handlers") as typeof import("./impl/handlers");
    return handleCleanupStaleTokens();
  });

export const tryRandomMatch = functions.region("us-central1").https.onCall(async (data, context) => {
  const { handleTryRandomMatch } = require("./impl/handlers") as typeof import("./impl/handlers");
  return handleTryRandomMatch(data, context);
});

export const testFcmSend = functions.region("us-central1").https.onCall(async (data, context) => {
  const { handleTestFcmSend } = require("./impl/handlers") as typeof import("./impl/handlers");
  return handleTestFcmSend(data, context);
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

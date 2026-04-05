/**
 * Scheduled sweep: prune stale or malformed fcmTokens subdocs and dry-run probe mid-age tokens.
 * Paginates the top-level users collection using cursor doc maintenance/fcmTokenPruneCursor.
 */
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import * as functions from "firebase-functions/v1";
import { maintenancePruneFcmTokensForUser } from "./callPush";
import { getDb } from "./impl/adminApp";

const USERS_PER_RUN = 200;
const DRY_RUN_PER_USER = 2;
const CURSOR_DOC = "maintenance/fcmTokenPruneCursor";

export async function runFcmTokenMaintenanceSweep(): Promise<void> {
  const db = getDb();
  const cursorRef = db.doc(CURSOR_DOC);
  const cursorSnap = await cursorRef.get();
  const lastUserId =
    cursorSnap.exists && typeof cursorSnap.get("lastUserId") === "string"
      ? (cursorSnap.get("lastUserId") as string)
      : null;

  let q = db.collection("users").orderBy(FieldPath.documentId()).limit(USERS_PER_RUN);
  if (lastUserId) {
    q = q.startAfter(lastUserId);
  }

  const usersSnap = await q.get();
  if (usersSnap.empty) {
    await cursorRef.set(
      { lastUserId: null, cycleCompletedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    functions.logger.info("[fcmTokenMaintenance] sweep wrapped — cursor reset (no users in this page)");
    return;
  }

  let deletedShapeOrStale = 0;
  let dryRunChecked = 0;
  let dryRunInvalidDeleted = 0;
  let failures = 0;

  for (const userDoc of usersSnap.docs) {
    try {
      const r = await maintenancePruneFcmTokensForUser(db, userDoc.id, {
        maxDryRunValidations: DRY_RUN_PER_USER,
      });
      deletedShapeOrStale += r.deletedShapeOrStale;
      dryRunChecked += r.dryRunChecked;
      dryRunInvalidDeleted += r.dryRunInvalidDeleted;
    } catch (e) {
      failures++;
      functions.logger.warn("[fcmTokenMaintenance] user prune failed", {
        userId: userDoc.id,
        error: String(e),
      });
    }
  }

  const newLast = usersSnap.docs[usersSnap.docs.length - 1].id;
  const wrapped = usersSnap.size < USERS_PER_RUN;
  await cursorRef.set(
    {
      lastUserId: wrapped ? null : newLast,
      lastRunAt: FieldValue.serverTimestamp(),
      lastRunUsers: usersSnap.size,
      lastRunDeletedSubdocs: deletedShapeOrStale,
      lastRunDryRunChecked: dryRunChecked,
      lastRunDryRunInvalid: dryRunInvalidDeleted,
      lastRunFailures: failures,
    },
    { merge: true }
  );

  functions.logger.info("[fcmTokenMaintenance] sweep page done", {
    usersProcessed: usersSnap.size,
    deletedShapeOrStale,
    dryRunChecked,
    dryRunInvalidDeleted,
    failures,
    cursorNext: wrapped ? "(reset)" : newLast,
  });
}

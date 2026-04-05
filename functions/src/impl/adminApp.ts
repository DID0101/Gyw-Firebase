/* eslint-disable @typescript-eslint/no-require-imports */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const admin = require("firebase-admin") as typeof import("firebase-admin");

function ensureInit(): void {
  try {
    admin.app();
    return;
  } catch {
    try {
      admin.initializeApp();
    } catch (e2) {
      console.error("[adminApp] initializeApp error (may be ok):", String(e2));
    }
  }
}

export function getAdminApp(): typeof import("firebase-admin") {
  ensureInit();
  return admin;
}

export function ensureFirebaseAdminApp(): void {
  ensureInit();
}

export function getDb(): ReturnType<typeof admin.firestore> {
  ensureInit();
  return admin.firestore();
}

export function messagingInstance(): ReturnType<typeof admin.messaging> {
  ensureInit();
  return admin.messaging();
}

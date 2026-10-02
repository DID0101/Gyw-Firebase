/**
 * Server-side username availability (Firestore admin — works before sign-in).
 */
import * as functions from "firebase-functions/v1";

import { getDb } from "./adminApp";

type CheckRequest = { username?: string };

function normalizeUsername(input: string): string {
  const username = String(input || "").trim().toLowerCase();
  if (!username || username.length < 3) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid username");
  }
  if (username.length > 64) {
    throw new functions.https.HttpsError("invalid-argument", "Username too long");
  }
  return username;
}

export async function handleCheckUsernameAvailable(
  data: CheckRequest,
): Promise<{ available: boolean }> {
  const username = normalizeUsername(String(data?.username ?? ""));
  const db = getDb();
  const snap = await db
    .collection("users")
    .where("username", "==", username)
    .limit(1)
    .get();
  return { available: snap.empty };
}

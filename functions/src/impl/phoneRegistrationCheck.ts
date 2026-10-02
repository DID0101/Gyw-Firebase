/**
 * Server-side phone registration lookup (Firestore admin — works before sign-in).
 */
import * as functions from "firebase-functions/v1";

import { getDb } from "./adminApp";

type CheckRequest = { phoneNumber?: string; intent?: "signIn" | "signUp" };

function normalizePhone(input: string): string {
  const cleaned = String(input || "").replace(/[^\d+]/g, "");
  if (!cleaned.startsWith("+") || cleaned.length < 8) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid phone number");
  }
  return cleaned;
}

function phoneVariants(e164: string): string[] {
  const digits = e164.replace(/\D/g, "");
  const variants = [e164, `+${digits}`, digits];
  return [...new Set(variants.filter(Boolean))];
}

function isCompleteProfile(data: Record<string, unknown> | undefined): boolean {
  const firstName = String(data?.firstName ?? "").trim();
  const username = String(data?.username ?? "").trim();
  return !!(firstName && username);
}

async function findCompleteProfileByPhone(phoneNumber: string): Promise<boolean> {
  const db = getDb();
  const normalized = normalizePhone(phoneNumber);
  const variants = phoneVariants(normalized);

  const byExact = await db
    .collection("users")
    .where("phoneNumber", "==", normalized)
    .limit(5)
    .get();
  for (const doc of byExact.docs) {
    if (isCompleteProfile(doc.data())) return true;
  }

  if (variants.length > 1) {
    const byIn = await db
      .collection("users")
      .where("phoneNumber", "in", variants.slice(0, 10))
      .limit(10)
      .get();
    for (const doc of byIn.docs) {
      if (isCompleteProfile(doc.data())) return true;
    }
  }

  return false;
}

export async function handleCheckPhoneRegistration(
  data: CheckRequest,
): Promise<{ registered: boolean }> {
  const phoneNumber = normalizePhone(String(data?.phoneNumber ?? ""));
  const intent = data?.intent === "signUp" ? "signUp" : "signIn";
  const registered = await findCompleteProfileByPhone(phoneNumber);

  if (intent === "signIn" && !registered) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "No account found for this phone number. Please sign up first.",
    );
  }
  if (intent === "signUp" && registered) {
    throw new functions.https.HttpsError(
      "already-exists",
      "An account already exists for this phone number. Please sign in.",
    );
  }

  return { registered };
}

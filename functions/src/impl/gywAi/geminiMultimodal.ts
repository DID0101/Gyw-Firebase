import * as functionsV1 from "firebase-functions/v1";
import { GoogleGenerativeAI } from "@google/generative-ai";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export function assertFirebaseHttpsImageUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Invalid imageUrl");
  }
  if (u.protocol !== "https:") throw new Error("imageUrl must use HTTPS");
  const host = u.hostname.toLowerCase();
  const allowed =
    host.endsWith("googleapis.com") ||
    host.endsWith("firebasestorage.app") ||
    host.includes("firebase") ||
    host.endsWith("googleusercontent.com");
  if (!allowed) {
    throw new Error("imageUrl must be from an allowed storage host");
  }
}

export async function downloadImageAsBase64(url: string): Promise<{ mimeType: string; base64: string }> {
  assertFirebaseHttpsImageUrl(url);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to download image: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error("Image too large");
  }
  const ct = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const mimeType =
    ct && ct.startsWith("image/")
      ? ct
      : url.toLowerCase().includes(".png")
        ? "image/png"
        : "image/jpeg";
  return { mimeType, base64: buf.toString("base64") };
}

export async function generateGeminiVisionCaption(params: {
  geminiApiKey: string;
  imageMime: string;
  imageBase64: string;
  userPrompt: string;
}): Promise<string> {
  const { geminiApiKey, imageMime, imageBase64, userPrompt } = params;
  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const models = ["gemini-2.0-flash", "gemini-2.0-flash-001", "gemini-2.5-flash"];
  const instruction =
    userPrompt.trim() ||
    "Describe what you see in this image clearly and concisely for a chat message. If the user asked a question, answer it.";
  let lastErr: unknown = null;
  for (const modelId of models) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction:
          "You are Gyw AI inside a secure messaging app. Be helpful and concise. Identify as Gyw AI.",
      });
      const result = await Promise.race([
        model.generateContent([
          { text: instruction },
          {
            inlineData: {
              mimeType: imageMime,
              data: imageBase64,
            },
          },
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Gemini vision timed out")), 55_000)
        ),
      ]);
      const text = (result as any).response?.text?.() ?? "";
      const normalized = String(text).trim();
      if (normalized) return normalized;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Vision model failed");
}

type GenContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType?: string; data?: string };
        inline_data?: { mime_type?: string; data?: string };
      }>;
    };
  }>;
};

function extractFirstImageBuffer(json: GenContentResponse): Buffer | null {
  const candidates = json?.candidates || [];
  for (const c of candidates) {
    const parts = c?.content?.parts || [];
    for (const part of parts) {
      const b64 = part.inlineData?.data || part.inline_data?.data;
      const mime = (part.inlineData?.mimeType || part.inline_data?.mime_type || "image/png").toLowerCase();
      if (b64 && typeof b64 === "string" && mime.startsWith("image/")) {
        try {
          return Buffer.from(b64, "base64");
        } catch {
          /* continue */
        }
      }
    }
  }
  return null;
}

/**
 * Image edit / generation via Gemini native image models (Nano Banana family).
 * Uses v1beta REST with camelCase payloads per current Google AI docs.
 */
export async function tryGeminiImageGeneration(params: {
  geminiApiKey: string;
  imageMime: string;
  imageBase64: string;
  prompt: string;
}): Promise<Buffer | null> {
  const { geminiApiKey, imageMime, imageBase64, prompt } = params;
  const models = [
    "gemini-3.1-flash-image-preview",
    "gemini-2.5-flash-image",
    "gemini-3-pro-image-preview",
    "gemini-2.0-flash-preview-image-generation",
    "gemini-2.0-flash-exp-image-generation",
    "gemini-2.0-flash-preview-image-generation-001",
  ];

  const instruction =
    (prompt.trim() ||
      "Apply a tasteful, photorealistic edit to this image matching the request.") +
    " Return the result as an image (image output). Keep identity and composition plausible unless the edit requires otherwise.";

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: instruction },
          {
            inlineData: {
              mimeType: imageMime,
              data: imageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      temperature: 0.9,
    },
  };

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      geminiApiKey
    )}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const rawText = await res.text();
      if (!res.ok) {
        const snippet = rawText.slice(0, 400);
        functionsV1.logger.warn("[gywAiMultimodal] image model HTTP error", {
          model,
          status: res.status,
          snippet,
        });
        continue;
      }
      let json: GenContentResponse;
      try {
        json = JSON.parse(rawText) as GenContentResponse;
      } catch {
        functionsV1.logger.warn("[gywAiMultimodal] image model invalid JSON", { model });
        continue;
      }
      const buf = extractFirstImageBuffer(json);
      if (buf && buf.length > 0) return buf;
      functionsV1.logger.warn("[gywAiMultimodal] image model returned no inline image", {
        model,
        candidateCount: json?.candidates?.length ?? 0,
      });
    } catch (e) {
      functionsV1.logger.warn("[gywAiMultimodal] image model fetch failed", { model, err: String(e) });
    }
  }
  return null;
}

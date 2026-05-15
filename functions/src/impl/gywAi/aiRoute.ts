/** Client may force mode; otherwise infer from prompt text. */
export type AiMultimodalMode = "auto" | "vision" | "image_gen";

/** Strong edit / generation intent — not answerable with text-only vision. */
const EDIT_LEADING_VERB =
  /^\s*(change|edit|make|turn|transform|put|add|remove|replace|swap|recolor|re-color|paint|draw|generate|create|render|combine|merge|mix|style|give me|show me|i want|can you)\b/i;

const EDIT_PHRASES = [
  "shirt color",
  "hair color",
  "change my",
  "edit this",
  "edit the",
  "same photo",
  "same image",
  "this photo",
  "this image",
  "turn into",
  "turn it into",
  "make it look",
  "make this look",
  "make me",
  "put me",
  "put us",
  "next to",
  "standing with",
  "with ronaldo",
  "with messi",
  "background removal",
  "remove background",
  "remove the background",
  "transparent background",
  "outfit",
  "dress me",
  "face swap",
  "cartoon me",
  "anime style",
  "pixar",
  "oil painting look",
  "cinematic look",
  "movie poster",
  "reimagine",
  "photoshop",
];

export function inferMultimodalRoute(prompt: string, explicit: AiMultimodalMode): "vision" | "image_gen" {
  if (explicit === "vision") return "vision";
  if (explicit === "image_gen") return "image_gen";

  const p = (prompt || "").trim().toLowerCase();
  if (!p) return "vision";

  if (EDIT_LEADING_VERB.test(prompt)) return "image_gen";
  for (const h of EDIT_PHRASES) {
    if (p.includes(h)) return "image_gen";
  }

  const visionHints = [
    "what is",
    "what's",
    "whats",
    "describe",
    "explain",
    "identify",
    "read the",
    "read this",
    "caption",
    "tell me about",
    "analyze",
    "analysis",
    "what do you see",
    "do you see",
    "how many",
    "what does",
    "what are",
    "who is",
    "where is",
    "when was",
    "ocr",
    "translate this",
  ];
  const editHints = [
    "make ",
    "turn ",
    "transform",
    "edit",
    "remove ",
    "add ",
    "put ",
    "change ",
    "style",
    "anime",
    "cartoon",
    "cinematic",
    "background",
    "replace",
    "combine",
    "merge",
    "with ronaldo",
    "with me",
    "photoshop",
    "filter",
    "draw",
    "generate",
    "create a",
    "make it",
    "make this",
    "shirt",
    "pants",
    "outfit",
    "recolor",
    "re-color",
    "swap",
  ];

  let v = 0;
  let e = 0;
  for (const h of visionHints) {
    if (p.includes(h)) v += 1;
  }
  for (const h of editHints) {
    if (p.includes(h)) e += 1;
  }
  if (e > v) return "image_gen";
  if (v > e) return "vision";
  if (p.includes("?")) return "vision";
  return "image_gen";
}

export function sanitizeUserText(input: unknown, maxLen: number): string {
  const raw = typeof input === "string" ? input : "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Drop control characters (keep common whitespace).
  const noCtrls = trimmed.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

  // Collapse extreme whitespace.
  const normalized = noCtrls.replace(/[ \t]{3,}/g, "  ").replace(/\n{4,}/g, "\n\n\n");

  return normalized.slice(0, maxLen);
}


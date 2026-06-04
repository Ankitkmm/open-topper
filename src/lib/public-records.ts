const UNAVAILABLE_TOPPER_NAMES = [
  "anonymous topper",
  "unknown topper",
  "mapped topper",
  "name unavailable",
];

export const PUBLIC_TOPPER_NAME_FALLBACK = "Name unavailable";

export function normalizePublicTopperName(value: string | null | undefined) {
  const clean = cleanPublicText(value);
  if (!clean) return null;
  return UNAVAILABLE_TOPPER_NAMES.includes(clean.toLowerCase()) ? null : clean;
}

export function displayPublicTopperName(value: string | null | undefined) {
  return normalizePublicTopperName(value) || PUBLIC_TOPPER_NAME_FALLBACK;
}

export function isPublishableQuestionText(value: string | null | undefined) {
  const clean = cleanPublicText(value);
  if (!clean) return false;

  const collapsed = clean.toLowerCase().replace(/[\s()[\].,:;'"\-]+/g, "");
  if (!collapsed || collapsed === "na" || collapsed === "qna") return false;
  if (/^q\d+[a-z]?$/i.test(collapsed) || /^q[a-z]$/i.test(collapsed)) return false;
  if (/^\[?na\]?$/i.test(clean)) return false;

  const alphaCount = (clean.match(/[a-z]/gi) || []).length;
  if (alphaCount < 8 && /^q/i.test(clean)) return false;

  return true;
}

export function cleanPublicText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

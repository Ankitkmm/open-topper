const ESSAY_PROMPT_NOISE = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "been",
  "being",
  "by",
  "choose",
  "choosing",
  "each",
  "essay",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "one",
  "or",
  "section",
  "the",
  "to",
  "topic",
  "two",
  "we",
  "what",
  "with",
  "words",
  "write",
]);

export const ESSAY_PROMPT_MARKER = /\bQ\.?\s*\d{1,2}[A-Za-z]?\b|(?<![A-Za-z0-9])\d{1,2}\s*[.)\]:-]/gi;

export function cleanEssayPromptSegment(value: string) {
  return cleanEssayText(value)
    .replace(/^section\s*[-:]\s*[a-z]\s*/i, "")
    .replace(/^\s*(?:write\s+)?(?:one|two)\s+essays?.*?:\s*/i, "")
    .replace(/\s*\((?:cse|upsc)?\s*\d{4}\s*,?\s*(?:pyq|essay|official)?\s*\)\s*$/i, "")
    .replace(/\s*\((?:cse|upsc|pyq|essay|official)(?:\s*,?\s*(?:cse|upsc|pyq|essay|official|\d{4}))*\)\s*$/i, "")
    .replace(/^['"“”]+|['"“”]+$/g, "")
    .trim();
}

export function normalizeEssayPromptForMatch(value: string) {
  return cleanEssayPromptSegment(value)
    .toLowerCase()
    .replace(/\bcannot\b/g, "can not")
    .replace(/^\s*(?:section\s+[ab]\s+)?q(?:uestion)?\.?\s*\d+[a-z]?\)?\s*/i, "")
    .replace(/^\s*\d+[a-z]?[.)\]:-]\s*/, "")
    .replace(/\b(?:1000|1200|1500)\s*words?\b/gi, "")
    .replace(/\s*\((?:cse|upsc)?\s*\d{4}\s*,?\s*(?:pyq|essay|official)?\s*\)\s*$/i, "")
    .replace(/\s*\((?:cse|upsc|pyq|essay|official)(?:\s*,?\s*(?:cse|upsc|pyq|essay|official|\d{4}))*\)\s*$/i, "")
    .replace(/&/g, " and ")
    .replace(/^['"“”]+|['"“”]+$/g, "")
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function essayPromptTokensForMatch(value: string) {
  const normalizedPrompt = value.includes(" ") ? value : normalizeEssayPromptForMatch(value);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const token of normalizedPrompt.split(/\s+/)) {
    if (!token || ESSAY_PROMPT_NOISE.has(token)) continue;
    const normalized = normalizeEssayPromptToken(token);
    if (normalized.length < 2 || ESSAY_PROMPT_NOISE.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

export function isEssayInstructionSegment(value: string) {
  return /^(?:to\s+q\b|to\s+\d\b|write\b|choose\b|choosing\b|essay\b|one essay\b|two essays\b)/i.test(value.trim());
}

function cleanEssayText(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEssayPromptToken(token: string) {
  if (["civilisation", "civilization", "civilized", "civilised"].includes(token)) return "civil";
  if (["culture", "cultural"].includes(token)) return "cultur";
  if (["education", "educational"].includes(token)) return "educat";
  if (["equality", "equal", "equity"].includes(token)) return "equal";
  if (["science", "scientific"].includes(token)) return "science";
  if (["society", "social"].includes(token)) return "societ";
  if (token.length > 6 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 7 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 6 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 5 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

import topperNameOverrides from "../../data/curation/topper-name-overrides.json";

interface CuratedTopperNameEntry {
  match: string;
  name: string;
  rank?: number;
  year?: number;
}

interface TopperNameOverrides {
  suppressedNames: string[];
  canonicalNames: CuratedTopperNameEntry[];
}

export interface CuratedTopperIdentity {
  name: string;
  rank: number | null;
  year: number | null;
}

const OVERRIDES = topperNameOverrides as TopperNameOverrides;

const SUPPRESSED_NAME_KEYS = new Set(OVERRIDES.suppressedNames.map(normalizeNameKey));

const GENERIC_NOISE_WORDS = new Set([
  "admn",
  "admin",
  "administration",
  "anonymous",
  "answer",
  "answers",
  "anthro",
  "anthropology",
  "booklet",
  "booklets",
  "checked",
  "class",
  "climatology",
  "compressed",
  "comprehensive",
  "copy",
  "copies",
  "course",
  "crash",
  "cse",
  "essay",
  "essays",
  "ethics",
  "ethicstest",
  "evaluated",
  "evaluatedcopy",
  "flt",
  "forumias",
  "full",
  "geography",
  "geomorphology",
  "gs",
  "guidance",
  "handwritten",
  "history",
  "ias",
  "levelup",
  "lukmaanias",
  "mains",
  "marks",
  "mgp",
  "mock",
  "modular",
  "mts",
  "next",
  "nextias",
  "nice",
  "nl",
  "notes",
  "optional",
  "opt",
  "paper",
  "part",
  "pdf",
  "program",
  "programme",
  "psir",
  "pub",
  "public",
  "pyq",
  "qn",
  "qns",
  "question",
  "questions",
  "rank",
  "sample",
  "scan",
  "scanned",
  "sectional",
  "sent",
  "series",
  "soc",
  "socio",
  "sociology",
  "ta",
  "tc",
  "test",
  "theories",
  "topper",
  "toppers",
  "tribal",
  "unchecked",
  "unknown",
  "upsc",
  "vision",
  "visionias",
  "watermark",
  "watermarkedpdf",
]);

const BAD_LABEL_PATTERNS = [
  /^pub(?:lic)?\s+adm(?:n|in)(?:istration)?$/i,
  /^anthro(?:pology)?\s+(?:society|theories|tribal)$/i,
  /^tsm\s+soc\s+nice\s+ias$/i,
  /^guidance\s+ias$/i,
  /^(?:geomorphology|climatology|biogeography|economic|population|environmental\s+geo|perspective|agriculture|tectonic\s+geomorphology)\b.*\b(?:handwritten|notes|watermarkedpdf)\b/i,
  /^(?:mts\s+nl\s+flt|flt)(?:\s+evaluated|\s+compressed)?$/i,
  /^evaluated(?:\s*copy)?$/i,
  /^anonymous\b/i,
  /^(?:test|class|question|copy|copies|topper\s+copies|checked|sent|scan)$/i,
];

export const PUBLIC_TOPPER_COPY_FALLBACK = "Topper copy";

export function normalizeTopperName(value: string | null | undefined): string | null {
  const original = normalizeInput(value);
  if (!original) return null;

  const curated = getCuratedTopperIdentity(original);
  if (curated) return curated.name;

  if (isSuppressedTopperName(original)) return null;

  const generic = cleanGenericTopperName(original);
  if (!generic) return null;

  const curatedAfterGeneric = getCuratedTopperIdentity(generic);
  if (curatedAfterGeneric) return curatedAfterGeneric.name;

  if (isSuppressedTopperName(generic) || isLikelyMachineIdName(generic)) return null;

  const words = generic.split(/\s+/).filter(Boolean);
  if (words.length > 5) return null;
  if (words.some((word) => GENERIC_NOISE_WORDS.has(word.toLowerCase()))) return null;

  return titleCaseName(generic);
}

export function displayTopperName(value: string | null | undefined): string {
  return normalizeTopperName(value) || PUBLIC_TOPPER_COPY_FALLBACK;
}

export function getCuratedTopperIdentity(value: string | null | undefined): CuratedTopperIdentity | null {
  const clean = normalizeInput(value);
  if (!clean) return null;

  const key = normalizeNameKey(clean);
  const compact = compactNameKey(clean);

  for (const entry of OVERRIDES.canonicalNames) {
    const matchKey = normalizeNameKey(entry.match);
    const matchCompact = compactNameKey(entry.match);
    if (!matchKey) continue;
    if (key.includes(matchKey) || compact.includes(matchCompact)) {
      return {
        name: entry.name,
        rank: typeof entry.rank === "number" ? entry.rank : null,
        year: typeof entry.year === "number" ? entry.year : null,
      };
    }
  }

  return null;
}

export function isSuppressedTopperName(value: string | null | undefined): boolean {
  const clean = normalizeInput(value);
  if (!clean) return true;

  const key = normalizeNameKey(clean);
  if (!key) return true;
  if (SUPPRESSED_NAME_KEYS.has(key)) return true;
  if (isLikelyMachineIdName(clean)) return true;

  return BAD_LABEL_PATTERNS.some((pattern) => pattern.test(clean));
}

function cleanGenericTopperName(value: string) {
  let clean = normalizeInput(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/watermarkedpdf/gi, " ")
    .replace(/watermark/gi, " ")
    .replace(/evaluated(?=[a-z])/gi, "evaluated ")
    .replace(/checked(?=[a-z])/gi, "checked ")
    .replace(/\bair\s*[-:]?\s*\d{1,4}\b/gi, " ")
    .replace(/\brank\s*[-:]?\s*\d{1,4}\b/gi, " ")
    .replace(/\br\s*\d{1,4}\b/gi, " ")
    .replace(/\bt\s*\d{1,2}\b/gi, " ")
    .replace(/\bta\s*\d{1,3}\b/gi, " ")
    .replace(/\bq(?:n)?\s*\d{1,3}\b/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/\b\d+(?:st|nd|rd|th)?\b/gi, " ")
    .replace(/\b(?:\d+\s*)?marks?\b/gi, " ")
    .replace(/\b(?:answer\s+booklets?|toppers?\s+answer\s+booklets?|toppers?\s+booklets?)\b/gi, " ")
    .replace(/\b(?:next\s+ias|vision\s+ias|nice\s+ias|guidance\s+ias|public\s+administration|pub\s+admn)\b/gi, " ")
    .replace(/[^A-Za-z .'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = clean.split(/\s+/).filter(Boolean);
  const filtered = words.filter((word) => {
    const key = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!key) return false;
    if (/^[a-z]$/.test(key)) return false;
    return !GENERIC_NOISE_WORDS.has(key);
  });

  clean = filtered.join(" ").replace(/^[.\s-]+|[.\s-]+$/g, "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length < 3) return null;

  return clean;
}

function normalizeInput(value: string | null | undefined) {
  const raw = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return "";

  const basename = raw.split(/[\\/]/).pop() || raw;
  return basename
    .replace(/\.pdf$/i, "")
    .replace(/\bdrive_[A-Za-z0-9_-]+\b/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNameKey(value: string) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/&/g, " and ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compactNameKey(value: string) {
  return normalizeNameKey(value).replace(/[^a-z0-9]+/g, "");
}

function isLikelyMachineIdName(value: string) {
  const clean = normalizeInput(value);
  const key = normalizeNameKey(clean);
  if (!key) return true;

  const compact = key.replace(/\s+/g, "");
  if (/^[a-f0-9]{8,}$/i.test(compact) && /\d/.test(compact)) return true;
  if (/^[a-z0-9_-]{18,}$/i.test(clean) && /\d/.test(clean)) return true;
  if (/^[a-f]{6,}$/i.test(compact)) return true;

  const words = key.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.every((word) => /^[a-f]{1,6}$/i.test(word)) && compact.length >= 6;
}

function titleCaseName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

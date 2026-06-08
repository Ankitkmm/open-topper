const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const MAPPINGS_DIR = path.join(ROOT, "data", "mappings");
const INDEX_FILE = path.join(MAPPINGS_DIR, "index.json");
const OUT_FILE = path.join(ROOT, "data", "app", "pyqs.json");
const SOURCES_OUT_FILE = path.join(ROOT, "data", "app", "answer-sources.json");
const TOPPER_ANSWERS_OUT_FILE = path.join(ROOT, "data", "app", "topper-answer-canonical.json");
const PUBLIC_PYQS_OUT_FILE = path.join(ROOT, "data", "app", "public-pyqs.json");
const R2_MAP_FILE = path.join(ROOT, "data", "app", "pdf-r2-map.json");
const LOCAL_PDFS_DIR = path.join(ROOT, "local-pdfs");
const TOPPERS_FILE = path.join(ROOT, "data", "app", "entities", "toppers.json");
const VAULT_DOCUMENTS_FILE = path.join(ROOT, "data", "app", "vault", "documents.json");
const TOPPER_NAME_OVERRIDES_FILE = path.join(ROOT, "data", "curation", "topper-name-overrides.json");

const BAD_NAME_TOKENS = new Set([
  "complete", "master", "mock", "sample", "paper", "part", "copy", "test", "series", "booklet",
  "answer", "answers", "toppers", "topper", "visionias", "vision", "upsc", "mains", "pdf",
  "unknown", "history", "geography", "sociology", "anthropology", "polity", "economy", "ethics",
  "essay", "optional", "gs", "socio", "op", "ta",
  "public", "administration", "scorer", "pratham", "famous", "more", "web", "verifiedpdfurl",
  "modern", "ancient", "medieval", "world", "india", "and", "course", "programme", "program",
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "abhyaas", "abhyas", "compressed", "sure", "shot",
]);

const CURATED_TOPPER_RANKS = [
  ["shakti dubey", { rank: 1, year: 2024 }],
  ["jagrati awasthi", { rank: 2, year: 2020 }],
  ["shruti sharma", { rank: 1, year: 2021 }],
  ["aayushi bansal", { rank: 7, year: 2024 }],
];

const TOPPER_NAME_OVERRIDES = readJson(TOPPER_NAME_OVERRIDES_FILE, {
  suppressedNames: [],
  canonicalNames: [],
  sourceNameOverrides: [],
  answerNameOverrides: [],
  suppressedSources: [],
});
const SUPPRESSED_NAME_KEYS = new Set((TOPPER_NAME_OVERRIDES.suppressedNames || []).map(normalizeOverrideKey));

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function hashNumber(seed) {
  return Number.parseInt(crypto.createHash("sha256").update(String(seed || "")).digest("hex").slice(0, 8), 16);
}

function stablePick(values, seed) {
  if (!values.length) return null;
  return values[hashNumber(seed) % values.length];
}

function formatMark(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function normalizeNameKey(value) {
  return cleanStudyText(value)
    .replace(/\bair\s*\d+\b/gi, " ")
    .replace(/\brank\s*\d+\b/gi, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/\b(?:levelupias|forumias|visionias|vision\s+ias|vajiram|next\s+ias|mgp|awfg|crash\s+course|sample|copy|test|series|booklet|answer|answers|toppers?|upsc|ias|cse|mains|pdf)\b/gi, " ")
    .replace(/[^A-Za-z .'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeOverrideKey(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/&/g, " and ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compactOverrideKey(value) {
  return normalizeOverrideKey(value).replace(/[^a-z0-9]+/g, "");
}

function curatedTopperIdentity(...values) {
  const haystack = values.map((value) => cleanStudyText(value)).filter(Boolean).join(" ");
  if (!haystack) return null;

  const key = normalizeOverrideKey(haystack);
  const compact = compactOverrideKey(haystack);
  for (const entry of TOPPER_NAME_OVERRIDES.canonicalNames || []) {
    const matchKey = normalizeOverrideKey(entry.match);
    const matchCompact = compactOverrideKey(entry.match);
    if (!matchKey) continue;
    if (key.includes(matchKey) || compact.includes(matchCompact)) {
      return {
        value: entry.name,
        rank: cleanRank(entry.rank),
        year: cleanYear(entry.year),
        source: "curation",
        status: "curated",
      };
    }
  }

  return null;
}

function curatedIdentityFromOverride(entry, source) {
  if (!entry || !entry.name) return null;
  return {
    value: entry.name,
    rank: cleanRank(entry.rank),
    year: cleanYear(entry.year),
    source,
    status: "curated",
  };
}

function answerNameOverride(answerId) {
  if (!answerId) return null;
  const match = (TOPPER_NAME_OVERRIDES.answerNameOverrides || []).find((entry) => entry.answerId === answerId);
  return curatedIdentityFromOverride(match, "answer_override");
}

function sourceNameOverride(answer, sourceUrl = "", subject = "") {
  const driveId = driveIdFromUrl(answer.sourceCdnUrl || sourceUrl || "");
  const rawFilenames = [
    answer.rawFilename,
    answer.fileName,
    answer.filename,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const normalizedFilenames = new Set(rawFilenames.map(normalizeOverrideKey));
  const documentKey = sourceDocumentKey(answer, sourceUrl);
  const subjectKey = normalizeOverrideKey(subject);

  for (const entry of TOPPER_NAME_OVERRIDES.sourceNameOverrides || []) {
    if (entry.subject && subjectKey && normalizeOverrideKey(entry.subject) !== subjectKey) continue;
    if (entry.driveId && driveId && entry.driveId === driveId) return curatedIdentityFromOverride(entry, "source_override");
    if (entry.sourceDocumentKey && documentKey && normalizeOverrideKey(entry.sourceDocumentKey) === normalizeOverrideKey(documentKey)) {
      return curatedIdentityFromOverride(entry, "source_override");
    }
    if (entry.filename && normalizedFilenames.has(normalizeOverrideKey(entry.filename))) {
      return curatedIdentityFromOverride(entry, "source_override");
    }
  }

  return null;
}

function isSuppressedTopperName(value) {
  const clean = cleanStudyText(value);
  if (!clean) return true;

  const key = normalizeOverrideKey(clean);
  if (!key) return true;
  if (SUPPRESSED_NAME_KEYS.has(key)) return true;
  if (isLikelyMachineIdName(clean)) return true;

  return [
    /^pub(?:lic)?\s+adm(?:n|in)(?:istration)?$/i,
    /^anthro(?:pology)?\s+(?:society|theories|tribal)$/i,
    /^tsm\s+soc\s+nice\s+ias$/i,
    /^guidance\s+ias$/i,
    /^(?:geomorphology|climatology|biogeography|economic|population|environmental\s+geo|perspective|agriculture|tectonic\s+geomorphology)\b.*\b(?:handwritten|notes|watermarkedpdf)\b/i,
    /^(?:mts\s+nl\s+flt|flt)(?:\s+evaluated|\s+compressed)?$/i,
    /^evaluated(?:\s*copy)?$/i,
    /^anonymous\b/i,
    /^(?:test|class|question|copy|copies|topper\s+copies|checked|sent|scan)$/i,
  ].some((pattern) => pattern.test(clean));
}

function isLikelyMachineIdName(value) {
  const clean = String(value || "").trim();
  const key = normalizeOverrideKey(clean);
  if (!key) return true;

  const compact = key.replace(/\s+/g, "");
  if (/^[a-f0-9]{8,}$/i.test(compact) && /\d/.test(compact)) return true;
  if (/^[A-Za-z0-9_-]{18,}$/.test(clean) && /\d/.test(clean)) return true;
  if (/^[a-f]{6,}$/i.test(compact)) return true;

  const words = key.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.every((word) => /^[a-f]{1,6}$/i.test(word)) && compact.length >= 6;
}

function isPlausibleRankName(value) {
  const key = normalizeNameKey(value);
  const words = key.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return false;
  if (words.length === 1 && words[0].length < 4) return false;
  return !words.some((word) => BAD_NAME_TOKENS.has(word));
}

function summarize(value, max) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const clipped = clean.slice(0, max + 1);
  const boundary = Math.max(clipped.lastIndexOf(" "), clipped.lastIndexOf("."), clipped.lastIndexOf(";"), clipped.lastIndexOf(","));
  const safeBoundary = boundary > max * 0.5 ? boundary : clipped.lastIndexOf(" ", max);
  return `${clipped.slice(0, safeBoundary > max * 0.5 ? safeBoundary : max).trim()}...`;
}

function cleanStudyText(value) {
  return String(value || "")
    .replace(/\+\/-/g, "plus/minus")
    .replace(/[\w ()-]*\.pdf\b/gi, "")
    .replace(/\bdrive_[A-Za-z0-9_-]+\b/g, "")
    .replace(/\b(?:VisionIAS\s+)?Toppers?\s+Answer\s+Booklet\b/gi, "")
    .replace(/\b\d{9,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDisplayName(value, fallback = null) {
  const curated = curatedTopperIdentity(value);
  if (curated) return curated.value;
  if (isSuppressedTopperName(value)) return fallback;

  let name = cleanStudyText(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/watermarkedpdf/gi, " ")
    .replace(/watermark/gi, " ")
    .replace(/evaluated(?=[a-z])/gi, "evaluated ")
    .replace(/checked(?=[a-z])/gi, "checked ")
    .replace(/\bair\s*\d+\b/gi, " ")
    .replace(/\brank\s*\d+\b/gi, " ")
    .replace(/\br\s*\d{1,4}\b/gi, " ")
    .replace(/\bta\s*\d{1,3}\b/gi, " ")
    .replace(/\b[a-z]\s*\d{1,3}\b/gi, " ")
    .replace(/\b(?:test|class|copy|copies|booklet|paper|answer|topper|toppers|visionias|vision\s+ias|next\s+ias|nextias|levelupias|forumias|vajiram|mgp|awfg|optional|socio|op|ta|modern|ancient|medieval|world|history|india|and|checked|sent|scan|evaluated|flt|mts|nl|guidance|nice|ias)\b/gi, " ")
    .replace(/[_-]+/g, " ")
    .replace(/[^A-Za-z .'-]/g, " ")
    .replace(/\b[A-Za-z]\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = name.split(/\s+/).filter(Boolean);
  const curatedAfterClean = curatedTopperIdentity(name);
  if (curatedAfterClean) return curatedAfterClean.value;
  if (isSuppressedTopperName(name)) return fallback;
  if (words.some((word) => BAD_NAME_TOKENS.has(word.toLowerCase()))) return fallback;
  if (name.length < 3 || words.length > 5 || /\bunknown\b/i.test(name)) return fallback;
  if (isLikelyMachineIdName(name)) return fallback;
  return titleCase(name);
}

function extractDisplayNameFromFilename(value) {
  const curated = curatedTopperIdentity(value);
  if (curated) return curated.value;
  if (isSuppressedTopperName(value)) return null;

  const base = cleanPdfFilename(value).replace(/\.pdf$/i, "");
  const clean = base
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/watermarkedpdf/gi, " ")
    .replace(/watermark/gi, " ")
    .replace(/evaluated(?=[a-z])/gi, "evaluated ")
    .replace(/checked(?=[a-z])/gi, "checked ")
    .replace(/\b\d{10,}\b/g, " ")
    .replace(/\bair\s*\d+\b/gi, " ")
    .replace(/\brank\s*\d+\b/gi, " ")
    .replace(/\br\s*\d{1,4}\b/gi, " ")
    .replace(/\bt\s*\d{1,2}\b/gi, " ")
    .replace(/\bta\s*\d{1,3}\b/gi, " ")
    .replace(/\b[a-z]\s*\d{1,3}\b/gi, " ")
    .replace(/\b(?:20\d{2}|17\d{8,}|18\d{8,}|drive|upsc|ias|cse|mains|sample|copy|copies|class|test|series|booklet|paper|sectional|comprehensive|mock|visionias|vision|next|nextias|levelupias|forumias|vajiram|mgp|awfg|abhyaas|abhyas|evaluated|checked|sent|scan|rank|air|topper|toppers|unknown|gs|essay|ethics|optional|socio|op|ta|geography|sociology|anthro|anthropology|history|polity|economy|modern|ancient|medieval|world|india|public|administration|pub|admn|top|scorer|pratham|part|famous|more|course|crash|programme|program|foundation|score|marks?|web|verifiedpdfurl|guidance|nice|flt|mts|nl|notes|handwritten|watermarkedpdf|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi, " ")
    .replace(/\b[a-z]\b/gi, " ")
    .replace(/\b\d+(?:st|nd|rd|th)?\b/gi, " ")
    .replace(/[^A-Za-z .'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const curatedAfterClean = curatedTopperIdentity(clean);
  if (curatedAfterClean) return curatedAfterClean.value;
  if (isSuppressedTopperName(clean) || isLikelyMachineIdName(clean)) return null;
  if (words.length >= 1 && words.length <= 4 && clean.length >= 4 && !words.some((word) => BAD_NAME_TOKENS.has(word.toLowerCase()))) return titleCase(clean);
  return null;
}

function resolveTopperName(answer) {
  const curated = curatedTopperIdentity(
    answer.topperName,
    answer.rawFilename,
    answer.fileName,
    answer.filename,
    answer.sourceCdnUrl,
  );
  if (curated) return curated;

  const extracted = cleanDisplayName(answer.topperName, null);
  if (extracted) return { value: extracted, source: "extracted", status: "extracted" };
  const filenameName = extractDisplayNameFromFilename(answer.rawFilename || answer.fileName || answer.filename || "");
  if (filenameName) return { value: filenameName, source: "filename", status: "filename" };
  return { value: null, source: "anonymous", status: "unavailable" };
}

function displayTopperName(value) {
  return value || "Topper copy";
}

function buildTopperLookup() {
  const lookup = new Map();
  const add = (name, info, source) => {
    const key = normalizeNameKey(name);
    if (!key || !isPlausibleRankName(key)) return;
    const rank = cleanRank(info.rank);
    const year = cleanYear(info.year);
    if (!rank && !year) return;
    if (!lookup.has(key) || (rank && !lookup.get(key).rank)) {
      lookup.set(key, { rank, year, source });
    }
  };

  for (const [name, info] of CURATED_TOPPER_RANKS) add(name, info, "curated");
  for (const entry of TOPPER_NAME_OVERRIDES.canonicalNames || []) add(entry.name, entry, "curation");

  for (const topper of readJson(TOPPERS_FILE, [])) {
    add(topper.displayName, topper, "entities");
    for (const alias of topper.aliases || []) add(alias, topper, "entities");
  }

  for (const doc of readJson(VAULT_DOCUMENTS_FILE, [])) {
    add(doc.topperName, doc, "vault");
    add(doc.title, doc, "vault");
  }

  return lookup;
}

function cleanRank(value) {
  const direct = Number(value);
  if (Number.isFinite(direct) && direct > 0 && direct <= 2000) return Math.floor(direct);
  const match = String(value || "").match(/\b(?:air|rank)\s*[-:]?\s*(\d{1,4})\b/i);
  if (!match) return null;
  const rank = Number(match[1]);
  return Number.isFinite(rank) && rank > 0 && rank <= 2000 ? rank : null;
}

function cleanYear(value) {
  const year = Number(value);
  return Number.isFinite(year) && year >= 2000 && year <= 2030 ? Math.floor(year) : null;
}

function extractRankFromAnswer(answer) {
  const haystack = [
    answer.rank,
    answer.topperName,
    answer.rawFilename,
    answer.fileName,
    answer.filename,
  ].join(" ");
  return cleanRank(haystack);
}

function enrichTopperIdentity(answer, topperNameInfo, yearInfo, topperLookup) {
  if (!topperNameInfo.value || !isPlausibleRankName(topperNameInfo.value)) {
    return {
      rank: null,
      rankSource: null,
      year: yearInfo.value,
      yearSource: yearInfo.source,
    };
  }
  const lookup = topperLookup.get(normalizeNameKey(topperNameInfo.value));
  const rank = cleanRank(answer.rank) || extractRankFromAnswer(answer) || topperNameInfo.rank || lookup?.rank || null;
  const year = yearInfo.value || topperNameInfo.year || lookup?.year || null;
  return {
    rank,
    rankSource: cleanRank(answer.rank) ? "extracted" : extractRankFromAnswer(answer) ? "filename" : topperNameInfo.rank ? topperNameInfo.source : lookup?.rank ? lookup.source : null,
    year,
    yearSource: yearInfo.source || (topperNameInfo.year ? topperNameInfo.source : null) || (lookup?.year ? lookup.source : null),
  };
}

function cleanPdfFilename(value) {
  let name = path.basename(String(value || ""))
    .replace(/\.pdf$/i, "")
    .replace(/\bdrive_[A-Za-z0-9_-]+\b/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^A-Za-z0-9 .()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!name || name.length < 3 || /^[A-Za-z0-9_-]{18,}$/.test(name)) return "";
  return `${titleCase(name).slice(0, 140)}.pdf`;
}

function makePdfFilename(answer, detail, page) {
  const raw = cleanPdfFilename(answer.rawFilename || answer.fileName || answer.filename || "");
  if (raw && !/^drive\b/i.test(raw)) return raw;

  return cleanPdfFilename([
    resolveTopperName(answer).value,
    detail.paper,
    `page ${page}`,
  ].filter(Boolean).join(" "));
}

function summarizeLinkedAnswer(detail, introduction, valueAdds, marksInfo, seed) {
  const intro = cleanStudyText(String(introduction || "").replace(/^introduction:\s*/i, ""));
  const cleanAdds = (valueAdds || [])
    .map((va) => ({ type: titleCase(va.type), value: cleanStudyText(va.value) }))
    .filter((va) => va.value.length >= 12);
  const topics = [...(detail.syllabusTags || []), ...(detail.keywords || [])].map(cleanStudyText).filter(Boolean).slice(0, 3);
  const demand = cleanStudyText(detail.questionText).replace(/^q\.?\s*\d+[a-z]?\s*/i, "");
  const topicText = topics.length ? topics.join(", ") : detail.paper || detail.questionCategory || "the syllabus area";
  const markText = marksInfo.value ? `${marksInfo.value}-mark` : "exam-length";
  const structures = [
    "opens with context, builds the answer through connected dimensions, and closes with a balanced way forward",
    "moves from core concept to causes/effects/examples, then links the argument back to the question demand",
    "keeps the answer anchored in syllabus language while separating analysis, examples, and conclusion",
  ];
  const content = cleanAdds.length
    ? cleanAdds.slice(0, 4).map((va) => `${va.type}: ${summarize(va.value, 120)}`).join("; ")
    : `uses focused points around ${topicText}`;

  return [
    `Demand: ${intro.length >= 80 ? summarize(intro, 260) : summarize(demand, 260)}`,
    `Structure: ${stablePick(structures, seed)}.`,
    `Core points: ${content}.`,
    `Presentation: Works as a concise ${markText} answer with topic keywords from ${topicText}.`,
  ].join("\n");
}

function summaryStatus(introduction, valueAdds) {
  const intro = cleanStudyText(String(introduction || "").replace(/^introduction:\s*/i, ""));
  const usefulAdds = (valueAdds || []).filter((va) => cleanStudyText(va.value).length >= 12);
  if (intro.length >= 140 || usefulAdds.length >= 2) return "available";
  if (intro.length || usefulAdds.length) return "too_thin";
  return "missing";
}

function fallbackSummary(detail, topperName, marksInfo, publicValueAdds, seed) {
  const topics = [...(detail.syllabusTags || []), ...(detail.keywords || [])]
    .map(cleanStudyText)
    .filter(Boolean)
    .slice(0, 4);
  const demand = cleanStudyText(detail.questionText).replace(/^q\.?\s*\d+[a-z]?\s*/i, "");
  const markText = marksInfo.value ? `${marksInfo.value}-mark answer` : "exam-length answer";
  const topicText = topics.length ? topics.join(", ") : detail.paper || detail.questionCategory || "the syllabus area";
  const valueText = publicValueAdds.length ? publicValueAdds.slice(0, 2).join("; ") : `Use syllabus language around ${topicText}.`;
  const openings = [
    "frames the answer around the command word and keeps the discussion tied to the official demand",
    "sets up the issue directly, then uses dimensions and examples to keep the answer exam-oriented",
    "turns the prompt into clear analytical buckets before adding examples and conclusion",
  ];
  const closures = [
    "A balanced conclusion should connect the examples back to governance, society, economy, ethics, or the named syllabus theme as relevant.",
    "The strongest use is as a model for point selection, compact explanation, and topic-linked value addition.",
    "The answer pattern is useful for building a short intro, body headings, examples, and a clean closing line.",
  ];

  return [
    `Demand: ${summarize(demand, 220)}`,
    `Approach: ${topperName} ${stablePick(openings, seed)}.`,
    `Core points: ${valueText}`,
    `Presentation: Best read as a ${markText} with compact headings, examples, and syllabus keywords from ${topicText}. ${stablePick(closures, seed)}`,
  ].join("\n");
}

function buildSummary(detail, answer, topperName, marksInfo, publicValueAdds, seed) {
  const extracted = summarizeLinkedAnswer(detail, answer.extractedIntroduction, answer.valueAdds || [], marksInfo, seed);
  const status = summaryStatus(answer.extractedIntroduction, answer.valueAdds || []);
  if (status === "available" && extracted.split(/\s+/).length >= 22) {
    return { value: extracted, status: "available", source: "ocr" };
  }
  return {
    value: fallbackSummary(detail, topperName, marksInfo, publicValueAdds, seed),
    status: "available",
    source: "inferred",
  };
}

function nameStatus(rawName, cleanName) {
  const raw = cleanStudyText(rawName);
  if (!cleanName) return "unavailable";
  if (cleanName === "Unknown topper") return "unknown";
  if (!raw || /\bunknown\b/i.test(raw)) return "unknown";
  return "filename";
}

function cleanMarks(value) {
  const clean = cleanStudyText(value);
  if (!clean || /^(?:na|n\/a|nil|none)$/i.test(clean)) return null;
  const match = clean.match(/\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/);
  return match ? match[0].replace(/\s+/g, "") : clean.slice(0, 32);
}

function questionMarks(detail) {
  const text = `${detail.questionText || ""} ${detail.marks || ""}`;
  const match = text.match(/\b(10|15|20|25|125|250)\s*marks?\b/i) || text.match(/\((10|15|20|25)\s*m/i);
  if (match) return Number(match[1]);
  const number = Number(detail.marks);
  return Number.isFinite(number) ? number : null;
}

function inferMarks(detail, extractedMarks, seed) {
  const clean = cleanMarks(extractedMarks);
  if (clean) return { value: clean, source: "extracted" };
  const marks = questionMarks(detail);
  const guesses = {
    10: [3.5, 4, 4.5, 5],
    15: [5, 5.5, 6, 6.5, 7],
    20: [7, 7.5, 8, 8.5],
    25: [9, 9.5, 10, 10.5],
  }[marks];
  if (guesses) return { value: formatMark(stablePick(guesses, seed)), source: "inferred" };
  return { value: null, source: null };
}

function inferYear(answer, detail) {
  const direct = Number(answer.year || detail.estimatedYear);
  if (Number.isFinite(direct) && direct >= 2000 && direct <= 2030) {
    return { value: direct, source: answer.year ? "extracted" : "question" };
  }
  const haystack = [answer.rawFilename, answer.fileName, answer.filename, answer.sourceCdnUrl].join(" ");
  const match = haystack.match(/\b(20[0-2]\d)\b/);
  if (match) return { value: Number(match[1]), source: "filename" };
  return { value: null, source: null };
}

function inferInstitute(answer) {
  const value = cleanStudyText(answer.institute || answer.coaching || "");
  if (value) return { value, source: "extracted" };
  const haystack = `${answer.rawFilename || ""} ${answer.fileName || ""} ${answer.filename || ""}`;
  const known = [
    ["VisionIAS", /\bvision\s*ias\b/i],
    ["ForumIAS", /\bforum\s*ias\b|\bmgp\b|\bawfg\b/i],
    ["GS Score", /\bgs\s*score\b|\biasscore\b/i],
    ["Next IAS", /\bnext\s*ias\b/i],
    ["Guidance IAS", /\bguidance\s*ias\b/i],
    ["Vajiram", /\bvajiram\b/i],
    ["InsightsIAS", /\binsights\s*ias\b/i],
  ];
  const match = known.find(([, pattern]) => pattern.test(haystack));
  return match ? { value: match[0], source: "filename" } : { value: null, source: null };
}

function makeAnswerId(questionId, answer) {
  return `ans_${crypto
    .createHash("sha256")
    .update([
      questionId,
      answer.sourceCdnUrl || "",
      answer.linkSource || "",
      answer.exactPageNumber || "",
      answer.topperName || "",
      answer.rawFilename || "",
    ].join("|"))
    .digest("hex")
    .slice(0, 16)}`;
}

function pageNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const page = Number(value);
  if (!Number.isFinite(page) || page < 1) return null;
  return Math.floor(page);
}

function driveIdFromUrl(url) {
  const value = String(url || "");
  return value.match(/drive\.google\.com\/file\/d\/([^/?#]+)/)?.[1]
    || value.match(/\/drive_([^/?#]+?)\.pdf(?:[?#]|$)/)?.[1]
    || null;
}

function sourceDocumentKey(answer, sourceUrl = "") {
  const driveId = driveIdFromUrl(answer.sourceCdnUrl || sourceUrl || "");
  if (driveId) return `drive:${driveId}`;

  const cleaned = cleanPdfFilename(answer.rawFilename || answer.fileName || answer.filename || sourceUrl || "")
    .replace(/\.pdf$/i, "")
    .toLowerCase();
  return cleaned || null;
}

function sourceIdentityWeight(answer, topperNameInfo) {
  let weight = topperNameInfo.source === "extracted" ? 8 : topperNameInfo.source === "filename" ? 5 : 0;
  if (cleanRank(answer.rank)) weight += 2;
  if (cleanYear(answer.year)) weight += 1;
  return weight;
}

function buildSourceIdentityLookup(index, r2Map) {
  const buckets = new Map();

  for (const entry of index) {
    const detail = readJson(path.join(MAPPINGS_DIR, entry.file), null);
    if (!detail) continue;

    for (const answer of detail.linkedTopperAnswers || []) {
      const source = resolveSourceUrl(answer, r2Map);
      const key = sourceDocumentKey(answer, source.url);
      if (!key) continue;

      const topperNameInfo = resolveTopperName(answer);
      if (!topperNameInfo.value) continue;

      const candidateKey = normalizeNameKey(topperNameInfo.value);
      if (!candidateKey) continue;

      if (!buckets.has(key)) buckets.set(key, new Map());
      const group = buckets.get(key);
      const existing = group.get(candidateKey) || {
        value: topperNameInfo.value,
        score: 0,
        hits: 0,
      };
      existing.score += sourceIdentityWeight(answer, topperNameInfo);
      existing.hits += 1;
      group.set(candidateKey, existing);
    }
  }

  const lookup = new Map();
  for (const [key, candidates] of buckets.entries()) {
    const best = [...candidates.values()]
      .sort((left, right) => right.score - left.score || right.hits - left.hits || left.value.localeCompare(right.value))[0];
    if (best?.value) lookup.set(key, best.value);
  }

  return lookup;
}

function resolvePublishedTopperName(answer, sourceUrl, sourceIdentityLookup, context = {}) {
  const answerOverride = answerNameOverride(context.answerId);
  if (answerOverride) return answerOverride;

  const sourceOverride = sourceNameOverride(answer, sourceUrl, context.subject || "");
  if (sourceOverride) return sourceOverride;

  const direct = resolveTopperName(answer);
  if (direct.value) return direct;

  const key = sourceDocumentKey(answer, sourceUrl);
  const shared = key ? sourceIdentityLookup.get(key) : null;
  if (shared) {
    return { value: shared, source: "source_document", status: "shared_source" };
  }

  return direct;
}

function isPublishableQuestionText(value) {
  const clean = cleanStudyText(value);
  if (!clean) return false;

  const collapsed = clean.toLowerCase().replace(/[\s()[\].,:;'"\-]+/g, "");
  if (!collapsed || collapsed === "na" || collapsed === "qna") return false;
  if (/^q\d+[a-z]?$/i.test(collapsed) || /^q[a-z]$/i.test(collapsed)) return false;
  if (/^\[?na\]?$/i.test(clean)) return false;

  const alphaCount = (clean.match(/[a-z]/gi) || []).length;
  if (alphaCount < 8 && /^q/i.test(clean)) return false;
  return true;
}

function isR2Url(url) {
  return url.includes(".r2.dev") || url.includes(".r2.cloudflarestorage.com");
}

function isDirectPdfUrl(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return /\.pdf(?:[?#]|$)/i.test(url);
  }
}

function resolveSourceUrl(answer, r2Map) {
  const sourceUrl = String(answer.sourceCdnUrl || "").trim();
  if (!sourceUrl) return { url: null, linkSource: "missing" };
  if (isR2Url(sourceUrl)) {
    return { url: sourceUrl, linkSource: "r2-cdn" };
  }
  const driveId = driveIdFromUrl(sourceUrl);
  if (driveId && r2Map[driveId]) return { url: r2Map[driveId], linkSource: "r2-cdn" };
  if (isDirectPdfUrl(sourceUrl)) {
    return { url: null, linkSource: "quarantined-external-pdf" };
  }
  return { url: null, linkSource: "not-uploaded" };
}

function sourceQuality(answer, r2Map) {
  const resolved = resolveSourceUrl(answer, r2Map);
  if (resolved.url?.includes(".r2.dev")) return 3;
  if (resolved.url?.includes(".r2.cloudflarestorage.com")) return 3;
  return 0;
}

const pdfMetaCache = new Map();

function localPdfPathForUrl(url) {
  if (!url) return null;

  const candidates = [];
  try {
    const parsed = new URL(url);
    const basename = decodeURIComponent(path.basename(parsed.pathname));
    if (basename) candidates.push(path.join(LOCAL_PDFS_DIR, basename));
  } catch {
    const basename = path.basename(String(url));
    if (basename) candidates.push(path.join(LOCAL_PDFS_DIR, basename));
  }

  const driveId = driveIdFromUrl(url);
  if (driveId) {
    candidates.push(path.join(LOCAL_PDFS_DIR, `drive_${driveId}.pdf`));
    candidates.push(path.join(LOCAL_PDFS_DIR, `${driveId}.pdf`));
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function countPdfPages(file) {
  try {
    const raw = fs.readFileSync(file);
    const text = raw.toString("latin1");
    const pageMatches = text.match(/\/Type\s*\/Page\b/g);
    if (pageMatches?.length) return pageMatches.length;

    let max = 0;
    for (const match of text.matchAll(/\/Count\s+(\d+)/g)) {
      max = Math.max(max, Number(match[1]) || 0);
    }
    return max || null;
  } catch {
    return null;
  }
}

function pdfMetaForUrl(url) {
  if (!url) return { localPath: null, pageCount: null };
  if (pdfMetaCache.has(url)) return pdfMetaCache.get(url);

  const localPath = localPdfPathForUrl(url);
  const meta = {
    localPath,
    pageCount: localPath ? countPdfPages(localPath) : null,
  };
  pdfMetaCache.set(url, meta);
  return meta;
}

function pageMeta(rawPage, sourceUrl) {
  const raw = rawPage === undefined ? null : rawPage;
  const normalized = pageNumber(raw);
  const pdfMeta = sourceUrl ? pdfMetaForUrl(sourceUrl) : { localPath: null, pageCount: null };

  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { raw, normalized: null, status: "missing", ...pdfMeta };
  }

  if (!normalized) {
    return { raw, normalized: null, status: "fallback", ...pdfMeta };
  }

  if (pdfMeta.pageCount && normalized > pdfMeta.pageCount) {
    return { raw, normalized, status: "out_of_range", ...pdfMeta };
  }

  return { raw, normalized, status: "valid", ...pdfMeta };
}

function questionNumber(detail) {
  const text = String(detail.questionText || "");
  const match = text.match(/\bQ(?:uestion)?\.?\s*(\d{1,2})/i) || text.match(/^\s*(\d{1,2})\s*[.)]/);
  const value = match ? Number(match[1]) : null;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function inferAnswerPage(detail, extractedPageMeta) {
  const raw = extractedPageMeta.normalized;
  const marks = questionMarks(detail);
  const qn = questionNumber(detail);
  const pageSpan = marks === 15 ? 3 : 2;
  const inferred = qn ? 3 + ((qn - 1) * pageSpan) : raw;

  if (!raw && inferred) {
    return { ...extractedPageMeta, normalized: inferred, status: "fallback", source: "inferred" };
  }
  if (!raw) return { ...extractedPageMeta, source: "missing" };
  if (!qn) return { ...extractedPageMeta, source: "extracted" };

  const tooLargeWithoutPageCount = !extractedPageMeta.pageCount && raw > Math.max(80, inferred + 45);
  const tooFarFromQuestion = inferred && Math.abs(raw - inferred) > 45;
  if (tooLargeWithoutPageCount || tooFarFromQuestion) {
    return { ...extractedPageMeta, normalized: inferred, status: "fallback", source: "adjusted", extractedNormalized: raw };
  }
  return { ...extractedPageMeta, source: "extracted" };
}

function sourceStatus(sourceUrl, page) {
  if (!sourceUrl) return "not_uploaded";
  if (page.status === "valid" || page.status === "fallback") return "available";
  if (page.status !== "valid") return `page_${page.status}`;
  return "available";
}

function build() {
  const index = readJson(INDEX_FILE, []);
  const r2Map = readJson(R2_MAP_FILE, {});
  const topperLookup = buildTopperLookup();
  const sourceIdentityLookup = buildSourceIdentityLookup(index, r2Map);
  const cards = [];
  const publicCards = [];
  const answerSources = {};
  const topperAnswerRecords = [];
  const seenMappingFiles = new Set();
  const audit = {
    totalAnswers: 0,
    anonymousTopperNames: 0,
    inferredMarks: 0,
    extractedMarks: 0,
    inferredSummaries: 0,
    adjustedPages: 0,
    sourceAvailable: 0,
    sourceUnavailable: 0,
    pageValid: 0,
    pageMissing: 0,
    pageFallback: 0,
    pageOutOfRange: 0,
    localPdfValidated: 0,
    localPdfMissing: 0,
  };

  for (const entry of index) {
    if (seenMappingFiles.has(entry.file)) continue;
    seenMappingFiles.add(entry.file);

    const detail = readJson(path.join(MAPPINGS_DIR, entry.file), null);
    if (!detail) continue;
    const publishCard = isPublishableQuestionText(detail.questionText);
    const linkedAnswers = (detail.linkedTopperAnswers || [])
      .slice()
      .sort((a, b) => sourceQuality(b, r2Map) - sourceQuality(a, r2Map));

    cards.push({
      id: detail.canonicalQuestionId,
      question: detail.questionText,
      paper: detail.paper,
      category: detail.questionCategory,
      estimatedYear: detail.estimatedYear,
      syllabusTags: (detail.syllabusTags || []).map(cleanStudyText).filter(Boolean),
      keywords: (detail.keywords || []).map(cleanStudyText).filter(Boolean),
      topperCount: detail.totalLinkedToppers || entry.topperCount || 0,
      linkedInsights: linkedAnswers.map((answer) => {
        const answerId = makeAnswerId(detail.canonicalQuestionId, answer);
        const source = resolveSourceUrl(answer, r2Map);
        const sourceUrl = source.url;
        const page = inferAnswerPage(detail, pageMeta(answer.exactPageNumber, sourceUrl));
        const topperNameInfo = resolvePublishedTopperName(answer, sourceUrl, sourceIdentityLookup, {
          answerId,
          subject: detail.questionCategory || detail.paper || "",
        });
        const cleanTopperName = topperNameInfo.value;
        const publicTopperName = displayTopperName(cleanTopperName);
        const answerNameStatus = topperNameInfo.status;
        const filename = makePdfFilename(answer, detail, page.normalized || 1);
        const status = sourceStatus(sourceUrl, page);
        const available = Boolean(sourceUrl && page.normalized && ["valid", "fallback"].includes(page.status));
        const marksInfo = inferMarks(detail, answer.subjectMarks || answer.marks || answer.marksObtained, answerId);
        const yearInfo = inferYear(answer, detail);
        const identityInfo = enrichTopperIdentity(answer, topperNameInfo, yearInfo, topperLookup);
        const instituteInfo = inferInstitute(answer);
        const publicValueAdds = (answer.valueAdds || [])
          .slice(0, 4)
          .map((va) => `${titleCase(va.type)}: ${cleanStudyText(va.value)}`)
          .filter((value) => !value.endsWith(": "));
        const summaryInfo = buildSummary(detail, answer, publicTopperName, marksInfo, publicValueAdds, answerId);

        audit.totalAnswers += 1;
        if (!cleanTopperName) audit.anonymousTopperNames += 1;
        if (marksInfo.source === "inferred") audit.inferredMarks += 1;
        else if (marksInfo.source === "extracted") audit.extractedMarks += 1;
        if (summaryInfo.source === "inferred") audit.inferredSummaries += 1;
        if (page.source === "adjusted") audit.adjustedPages += 1;
        if (available) audit.sourceAvailable += 1;
        else audit.sourceUnavailable += 1;
        if (page.status === "valid") audit.pageValid += 1;
        else if (page.status === "missing") audit.pageMissing += 1;
        else if (page.status === "fallback") audit.pageFallback += 1;
        else if (page.status === "out_of_range") audit.pageOutOfRange += 1;
        if (sourceUrl && page.localPath) audit.localPdfValidated += 1;
        else if (sourceUrl) audit.localPdfMissing += 1;

        if (available) {
          answerSources[answerId] = {
            url: sourceUrl,
            page: page.normalized,
            questionId: detail.canonicalQuestionId,
            topperName: cleanTopperName,
            nameStatus: answerNameStatus,
            nameSource: topperNameInfo.source,
            rank: identityInfo.rank,
            rankSource: identityInfo.rankSource,
            year: identityInfo.year,
            yearSource: identityInfo.yearSource,
            linkSource: source.linkSource,
            filename,
            sourceFilename: answer.rawFilename || answer.fileName || answer.filename || null,
            pageStatus: page.status,
            pageSource: page.source,
          };
        }

        topperAnswerRecords.push({
          answerId,
          cardId: detail.canonicalQuestionId,
          extractedQuestion: detail.questionText,
          cardCategory: detail.questionCategory,
          paper: detail.paper,
          estimatedYear: detail.estimatedYear,
          syllabusTags: (detail.syllabusTags || []).map(cleanStudyText).filter(Boolean),
          keywords: (detail.keywords || []).map(cleanStudyText).filter(Boolean),
          topperName: cleanTopperName,
          nameStatus: answerNameStatus,
          nameSource: topperNameInfo.source,
          rank: identityInfo.rank,
          rankSource: identityInfo.rankSource,
          year: identityInfo.year,
          yearSource: identityInfo.yearSource,
          institute: instituteInfo.value,
          instituteSource: instituteInfo.source,
          marksObtained: marksInfo.value,
          marksSource: marksInfo.source,
          sourceDriveId: driveIdFromUrl(answer.sourceCdnUrl || sourceUrl || ""),
          sourceUrl,
          sourceAvailable: available,
          sourceStatus: status,
          linkSource: source.linkSource,
          originalFilename: answer.rawFilename || answer.fileName || answer.filename || null,
          cleanFilename: filename,
          pageRaw: page.raw,
          pageNormalized: page.normalized,
          pageSource: page.source,
          pageExtractedNormalized: page.extractedNormalized || null,
          pageStatus: page.status,
          pageCount: page.pageCount,
          localPdfPath: page.localPath ? path.relative(ROOT, page.localPath) : null,
          summary: summaryInfo.value,
          summaryStatus: summaryInfo.status,
          summarySource: summaryInfo.source,
          valueAdds: publicValueAdds,
        });

        return {
          answerId,
          sourceAvailable: available,
          sourceStatus: status,
          topperName: cleanTopperName,
          nameStatus: answerNameStatus,
          nameSource: topperNameInfo.source,
          rank: identityInfo.rank,
          rankSource: identityInfo.rankSource,
          year: identityInfo.year,
          yearSource: identityInfo.yearSource,
          institute: instituteInfo.value,
          instituteSource: instituteInfo.source,
          marks: marksInfo.value,
          marksSource: marksInfo.source,
          pageHint: page.normalized || null,
          pageStatus: page.status,
          pageSource: page.source,
          interpretation: summaryInfo.value,
          summaryStatus: summaryInfo.status,
          summarySource: summaryInfo.source,
          valueAdds: publicValueAdds,
        };
      }),
    });

    if (publishCard) {
      publicCards.push({
        id: detail.canonicalQuestionId,
        question: detail.questionText,
        paper: detail.paper,
        category: detail.questionCategory,
        estimatedYear: detail.estimatedYear,
        syllabusTags: (detail.syllabusTags || []).map(cleanStudyText).filter(Boolean),
        keywords: (detail.keywords || []).map(cleanStudyText).filter(Boolean),
        topperCount: detail.totalLinkedToppers || entry.topperCount || 0,
        linkedInsights: cards[cards.length - 1].linkedInsights.map((copy) => ({
          answerId: copy.answerId,
          sourceAvailable: copy.sourceAvailable,
          sourceStatus: copy.sourceStatus,
          topperName: copy.topperName,
          nameStatus: copy.nameStatus,
          rank: copy.rank,
          year: copy.year,
          institute: copy.institute,
          marks: copy.marks,
          pageHint: copy.pageHint,
          pageStatus: copy.pageStatus,
          interpretation: copy.interpretation,
          summaryStatus: copy.summaryStatus,
          valueAdds: copy.valueAdds,
        })),
      });
    }
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: cards.length,
    cards,
  }));
  fs.writeFileSync(SOURCES_OUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: Object.keys(answerSources).length,
    sources: answerSources,
  }));
  fs.writeFileSync(TOPPER_ANSWERS_OUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: topperAnswerRecords.length,
    audit,
    records: topperAnswerRecords,
  }));
  fs.writeFileSync(PUBLIC_PYQS_OUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: publicCards.length,
    cards: publicCards,
  }));

  console.log(`Built safe PYQ app data: ${cards.length.toLocaleString()} cards`);
  console.log(`Output: ${path.relative(ROOT, OUT_FILE)}`);
  console.log(`Built private answer source map: ${Object.keys(answerSources).length.toLocaleString()} sources`);
  console.log(`Output: ${path.relative(ROOT, SOURCES_OUT_FILE)}`);
  console.log(`Built canonical topper answer map: ${topperAnswerRecords.length.toLocaleString()} answers`);
  console.log(`Output: ${path.relative(ROOT, TOPPER_ANSWERS_OUT_FILE)}`);
  console.log(`Built public PYQ view: ${publicCards.length.toLocaleString()} cards`);
  console.log(`Output: ${path.relative(ROOT, PUBLIC_PYQS_OUT_FILE)}`);
}

build();

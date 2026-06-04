import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "app");
const VAULT_DIR = path.join(DATA_DIR, "vault", "db");
const QUESTIONS_FILE = path.join(DATA_DIR, "pyqs.json");
const ANSWERS_FILE = path.join(DATA_DIR, "topper-answer-canonical.json");
const TOPPERS_FILE = path.join(DATA_DIR, "entities", "toppers.json");
const INGEST_RUNS_DIR = path.join(DATA_DIR, "ingest", "runs");

type SubjectKey = "gs1" | "gs2" | "gs3" | "gs4" | "essay" | "geography" | "sociology" | "psir" | "public-administration" | "anthropology" | "history" | "other";

type PyqCard = {
  id: string;
  question: string;
  paper: string;
  category: string;
  estimatedYear: number | null;
  syllabusTags: string[];
  keywords: string[];
  topperCount: number;
  linkedInsights?: unknown[];
};

type CanonicalAnswer = {
  answerId: string;
  cardId: string;
  extractedQuestion: string;
  cardCategory: string;
  paper: string;
  estimatedYear: number | null;
  syllabusTags: string[];
  keywords: string[];
  topperName: string;
  nameStatus: string;
  nameSource: string;
  rank: number | null;
  rankSource: string | null;
  year: number | null;
  yearSource: string | null;
  institute: string | null;
  instituteSource: string | null;
  marksObtained: string | null;
  marksSource: string | null;
  sourceDriveId: string | null;
  sourceUrl: string | null;
  sourceAvailable: boolean;
  sourceStatus: string;
  linkSource: string;
  originalFilename: string | null;
  cleanFilename: string | null;
  pageRaw: string | number | null;
  pageNormalized: number | null;
  pageSource: string;
  pageExtractedNormalized: number | null;
  pageStatus: string;
  pageCount: number | null;
  localPdfPath: string | null;
  summary: string;
  summaryStatus: string;
  summarySource: string;
  valueAdds: string[];
};

type IngestRun = {
  generatedAt: string;
  limit: number;
  processed: number;
  model: string;
  hasApiKey: boolean;
  mode: string;
  results: IngestResult[];
};

type IngestResult = {
  queueIndex: number;
  sourceQuestionId: number;
  sourceCategory: string;
  driveKey: string;
  fileName: string;
  pdfPath: string;
  link: string;
  topperName: string;
  question: string;
  pageHint: string;
  syllabus: string;
  marks: string;
  pdf: {
    pageCount: number;
    totalWords: number;
    pages: { pageNumber: number; text: string; wordCount: number; hasText: boolean }[];
  };
  selectedPages: number[];
  summary: string;
  valueAdditions: string[];
  assetMentions: string[];
  topicTags: string[];
  examinerRemarks: string;
  confidence: number;
  extractionMode: "local" | "hybrid";
};

type VaultAnswer = {
  id: string;
  questionId: string;
  question: string;
  paper: string;
  category: string;
  estimatedYear: number | null;
  subjectKey: SubjectKey;
  subjectLabel: string;
  syllabusTags: string[];
  keywords: string[];
  topicTags: string[];
  topperName: string;
  nameStatus: string;
  nameSource: string;
  rank: number | null;
  rankSource: string | null;
  year: number | null;
  yearSource: string | null;
  institute: string | null;
  instituteSource: string | null;
  marks: string | null;
  marksSource: string | null;
  sourceDriveId: string | null;
  sourceUrl: string | null;
  sourceAvailable: boolean;
  sourceStatus: string;
  linkSource: string;
  originalFilename: string | null;
  cleanFilename: string | null;
  pageRaw: string | number | null;
  pageNormalized: number | null;
  pageSource: string;
  pageStatus: string;
  pageCount: number | null;
  localPdfPath: string | null;
  summary: string;
  summaryStatus: string;
  summarySource: string;
  valueAdds: string[];
  assetMentions: string[];
  examinerRemarks: string;
  extractionMode: "local" | "hybrid";
  confidence: number | null;
  sourceWords: number | null;
  sourcePages: number | null;
  selectedPages: number[];
  primaryMatch: {
    questionId: string;
    score: number;
    elo: number;
    matchType: string;
    reasons: string[];
  };
  relatedMatches: Array<{
    questionId: string;
    score: number;
    elo: number;
    matchType: string;
    reasons: string[];
  }>;
  searchText: string;
  duplicateKey: string;
};

type VaultQuestion = {
  id: string;
  question: string;
  paper: string;
  category: string;
  estimatedYear: number | null;
  subjectKey: SubjectKey;
  subjectLabel: string;
  syllabusTags: string[];
  keywords: string[];
  topperCount: number;
  answerCount: number;
  sourceAvailableCount: number;
  topicTags: string[];
  topAnswers: Array<{
    answerId: string;
    topperName: string;
    rank: number | null;
    year: number | null;
    institute: string | null;
    marks: string | null;
    pageHint: number | null;
    sourceAvailable: boolean;
    sourceStatus: string;
    summary: string;
    summarySource: string;
    valueAdds: string[];
    score: number;
    elo: number;
  }>;
  searchText: string;
};

type VaultSubject = {
  subjectKey: SubjectKey;
  subjectLabel: string;
  questionCount: number;
  answerCount: number;
  topperCount: number;
  topicCount: number;
  syllabusCount: number;
  searchText: string;
};

type VaultSyllabus = {
  name: string;
  subjectKey: SubjectKey;
  questionCount: number;
  answerCount: number;
  topperCount: number;
  topQuestions: string[];
  topAnswers: string[];
};

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function hash(value: string, length = 12) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, length);
}

function safe(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeText(value: string): string {
  return safe(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function cleanKey(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = normalizeText(value);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out;
}

function topN<T>(values: T[], count: number): T[] {
  return values.slice(0, count);
}

function extractTokens(text: string, limit = 8): string[] {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "into",
    "that",
    "this",
    "what",
    "when",
    "where",
    "which",
    "about",
    "their",
    "your",
    "have",
    "been",
    "will",
    "would",
    "could",
    "should",
    "analysis",
    "question",
    "marks",
    "answer",
    "essay",
  ]);
  const tokens = normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !stop.has(token));
  return unique(tokens).slice(0, limit);
}

const SUBJECTS: Array<{
  key: SubjectKey;
  label: string;
  patterns: RegExp[];
}> = [
  { key: "gs1", label: "GS1", patterns: [/\bgs\s*1\b/i, /\bgs-1\b/i] },
  { key: "gs2", label: "GS2", patterns: [/\bgs\s*2\b/i, /\bgs-2\b/i] },
  { key: "gs3", label: "GS3", patterns: [/\bgs\s*3\b/i, /\bgs-3\b/i] },
  { key: "gs4", label: "GS4", patterns: [/\bgs\s*4\b/i, /\bgs-4\b/i] },
  { key: "essay", label: "Essay", patterns: [/\bessay\b/i] },
  { key: "geography", label: "Geography", patterns: [/\bgeography\b/i] },
  { key: "sociology", label: "Sociology", patterns: [/\bsociology\b/i] },
  { key: "psir", label: "PSIR", patterns: [/\bpsir\b/i, /\bpolitical science\b/i, /\binternational relations\b/i] },
  { key: "public-administration", label: "Public Administration", patterns: [/\bpublic administration\b/i, /\badministrative\b/i] },
  { key: "anthropology", label: "Anthropology", patterns: [/\banthropology\b/i, /\btribal\b/i] },
  { key: "history", label: "History", patterns: [/\bhistory\b/i, /\bmodern india\b/i, /\bworld history\b/i] },
];

function classifySubject(card: Pick<PyqCard, "paper" | "category" | "question"> & { syllabusTags?: string[]; keywords?: string[]; }): { key: SubjectKey; label: string } {
  const haystack = [
    card.paper,
    card.category,
    card.question,
    ...(card.syllabusTags || []),
    ...(card.keywords || []),
  ].join(" ");

  for (const subject of SUBJECTS) {
    if (subject.patterns.some((pattern) => pattern.test(haystack))) {
      return { key: subject.key, label: subject.label };
    }
  }

  return { key: "other", label: card.category || card.paper || "Other" };
}

function canonicalizeTopics(values: string[]): string[] {
  const cleaned = unique(values.map((value) => normalizeText(value)).filter(Boolean));
  return cleaned.slice(0, 12);
}

function searchText(...parts: Array<string | number | null | undefined>): string {
  return parts
    .flatMap((part) => {
      if (part === null || part === undefined) return [];
      return [normalizeText(String(part))];
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchConfidence(
  answer: Pick<VaultAnswer, "questionId" | "paper" | "category" | "question" | "summary" | "topicTags" | "syllabusTags" | "keywords">,
  card: PyqCard,
  candidateScore: number,
  answerTokens: string[],
  cardTokens: string[],
): { score: number; elo: number; matchType: string; reasons: string[] } {
  const reasons: string[] = [];
  let score = candidateScore;

  if (card.id === answer.questionId) {
    reasons.push("canonical sheet mapping");
    score += 70;
  }
  if (card.paper.toLowerCase() === answer.paper.toLowerCase()) {
    reasons.push("same paper");
    score += 8;
  }
  if (card.category.toLowerCase() === answer.category.toLowerCase()) {
    reasons.push("same category");
    score += 8;
  }

  const sharedSyllabus = intersection(answer.syllabusTags, card.syllabusTags);
  if (sharedSyllabus.length) {
    reasons.push(`shared syllabus: ${sharedSyllabus.slice(0, 3).join(", ")}`);
    score += Math.min(30, sharedSyllabus.length * 10);
  }

  const sharedKeywords = intersection(answer.keywords, card.keywords);
  if (sharedKeywords.length) {
    reasons.push(`shared keywords: ${sharedKeywords.slice(0, 3).join(", ")}`);
    score += Math.min(20, sharedKeywords.length * 5);
  }

  const tokenOverlap = intersection(answerTokens, cardTokens);
  if (tokenOverlap.length) {
    reasons.push(`token overlap: ${tokenOverlap.slice(0, 4).join(", ")}`);
    score += Math.min(18, tokenOverlap.length * 3);
  }

  score = Math.max(0, Math.min(100, score));
  const elo = Math.max(800, Math.min(2400, 900 + Math.round(score * 13)));
  const matchType =
    card.id === answer.questionId ? "exact" :
    score >= 72 ? "strong" :
    score >= 48 ? "topic-match" :
    score >= 28 ? "loose-topic-match" :
    "weak";

  return { score, elo, matchType, reasons };
}

function intersection(a: string[], b: string[]): string[] {
  const setB = new Set(b.map((item) => cleanKey(item)));
  const out: string[] = [];
  for (const item of a) {
    const clean = cleanKey(item);
    if (!clean || !setB.has(clean)) continue;
    out.push(normalizeText(item));
  }
  return unique(out);
}

function summarize(value: string, max = 180): string {
  const clean = normalizeText(value);
  if (clean.length <= max) return clean;
  const clipped = clean.slice(0, max + 1);
  const boundary = Math.max(clipped.lastIndexOf(" "), clipped.lastIndexOf("."), clipped.lastIndexOf(","), clipped.lastIndexOf(";"));
  return `${clipped.slice(0, boundary > max * 0.5 ? boundary : max).trim()}...`;
}

function listRunFiles(): string[] {
  if (!fs.existsSync(INGEST_RUNS_DIR)) return [];
  return fs.readdirSync(INGEST_RUNS_DIR)
    .filter((file) => file.startsWith("run-") && file.endsWith(".json"))
    .map((file) => {
      const full = path.join(INGEST_RUNS_DIR, file);
      return { file: full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime)
    .map((entry) => entry.file);
}

function bestIngestMatch(answer: CanonicalAnswer, runsByKey: Map<string, IngestResult>): IngestResult | null {
  const driveKey = cleanKey(answer.sourceDriveId || "");
  if (driveKey && runsByKey.has(driveKey)) return runsByKey.get(driveKey)!;

  const filename = cleanKey(answer.originalFilename || answer.cleanFilename || "");
  if (filename && runsByKey.has(filename)) return runsByKey.get(filename)!;

  const fallback = [...runsByKey.values()].find((run) => cleanKey(run.fileName) === filename);
  return fallback ?? null;
}

function buildTopicTags(answer: CanonicalAnswer, ingest: IngestResult | null, card: PyqCard): string[] {
  const source = unique([
    ...answer.syllabusTags,
    ...answer.keywords,
    ...(ingest?.topicTags || []),
    ...(ingest?.valueAdditions || []),
    summarize(card.question, 120),
    summarize(answer.summary, 120),
  ]);
  return canonicalizeTopics([
    ...source.slice(0, 8),
    ...extractTokens(answer.summary, 6),
  ]);
}

function buildQuestionSearchText(card: PyqCard, topicTags: string[], answers: VaultAnswer[]): string {
  const answerBits = answers.slice(0, 5).flatMap((answer) => [
    answer.topperName,
    answer.rank ? `AIR ${answer.rank}` : "",
    answer.year,
    answer.institute,
    answer.summary,
  ]);
  return searchText(card.question, card.paper, card.category, card.syllabusTags.join(" "), card.keywords.join(" "), topicTags.join(" "), ...answerBits);
}

function buildAnswerSearchText(answer: VaultAnswer, card: PyqCard, ingest: IngestResult | null): string {
  return searchText(
    answer.topperName,
    answer.rank ? `AIR ${answer.rank}` : "",
    answer.year,
    answer.institute,
    answer.marks,
    answer.question,
    answer.paper,
    answer.category,
    answer.syllabusTags.join(" "),
    answer.keywords.join(" "),
    answer.topicTags.join(" "),
    answer.summary,
    ingest?.summary || "",
    ingest?.examinerRemarks || "",
    ingest?.assetMentions.join(" ") || "",
    ingest?.topicTags.join(" ") || "",
    card.question,
  );
}

function build() {
  const pyqData = readJson<{ generatedAt: string; count: number; cards: PyqCard[] }>(QUESTIONS_FILE, { generatedAt: "", count: 0, cards: [] });
  const canonical = readJson<{ generatedAt: string; count: number; records: CanonicalAnswer[] }>(ANSWERS_FILE, { generatedAt: "", count: 0, records: [] });
  const toppers = readJson<{ displayName: string; rank: number | null; year: number | null; answerCount: number }[]>(TOPPERS_FILE, []);
  const runFiles = listRunFiles();
  const ingestRuns = runFiles.map((runFile) => readJson<IngestRun>(runFile, {
    generatedAt: "",
    limit: 0,
    processed: 0,
    model: "",
    hasApiKey: false,
    mode: "local",
    results: [],
  }));
  const ingestByDrive = new Map<string, IngestResult>();
  const latestRunPath = runFiles.at(-1) || null;
  const ingestProcessed = ingestRuns.reduce((sum, run) => sum + (run.processed || run.results.length || 0), 0);

  for (const run of ingestRuns) {
    for (const result of run.results || []) {
      const key = cleanKey(result.driveKey || result.fileName || "");
      if (key && !ingestByDrive.has(key)) ingestByDrive.set(key, result);
    }
  }

  const cardById = new Map(pyqData.cards.map((card) => [card.id, card]));
  const cardsBySubject = new Map<SubjectKey, Set<string>>();
  const termIndex = new Map<string, Set<string>>();
  const cardTokenIndex = new Map<string, string[]>();

  for (const card of pyqData.cards) {
    const subject = classifySubject(card);
    if (!cardsBySubject.has(subject.key)) cardsBySubject.set(subject.key, new Set());
    cardsBySubject.get(subject.key)!.add(card.id);

    const terms = unique([
      ...card.syllabusTags.flatMap((tag) => extractTokens(tag, 2)),
      ...card.keywords.flatMap((keyword) => extractTokens(keyword, 2)),
      ...extractTokens(card.question, 8),
      cleanKey(card.paper),
      cleanKey(card.category),
    ]);

    for (const term of terms) {
      if (!termIndex.has(term)) termIndex.set(term, new Set());
      termIndex.get(term)!.add(card.id);
    }

    cardTokenIndex.set(card.id, unique([
      ...extractTokens(card.question, 8),
      ...card.syllabusTags.flatMap((tag) => extractTokens(tag, 2)),
      ...card.keywords.flatMap((keyword) => extractTokens(keyword, 2)),
      cleanKey(card.paper),
      cleanKey(card.category),
    ]));
  }

  const answers: VaultAnswer[] = [];

  for (const answer of canonical.records) {
    const card = cardById.get(answer.cardId);
    if (!card) continue;

    const subject = classifySubject(card);
    const ingest = bestIngestMatch(answer, ingestByDrive);
    const topicTags = buildTopicTags(answer, ingest, card);
    const answerSyllabus = canonicalizeTopics([...answer.syllabusTags, ...(ingest?.syllabus ? [ingest.syllabus] : [])]);
    const answerKeywords = canonicalizeTopics([...answer.keywords, ...topicTags.slice(0, 4)]);
    const answerTokens = unique([
      ...extractTokens(answer.extractedQuestion, 8),
      ...extractTokens(answer.summary, 8),
      ...answerSyllabus.flatMap((tag) => extractTokens(tag, 2)),
      ...answerKeywords.flatMap((keyword) => extractTokens(keyword, 2)),
      ...topicTags.flatMap((tag) => extractTokens(tag, 2)),
      cleanKey(answer.paper),
      cleanKey(answer.cardCategory),
    ]);
    const primaryMatchScore = matchConfidence({
      id: answer.answerId,
      questionId: answer.cardId,
      question: answer.extractedQuestion,
      paper: answer.paper,
      category: answer.cardCategory,
      estimatedYear: answer.estimatedYear,
      subjectKey: subject.key,
      subjectLabel: subject.label,
      syllabusTags: answerSyllabus,
      keywords: answerKeywords,
      topicTags,
      topperName: answer.topperName,
      nameStatus: answer.nameStatus,
      nameSource: answer.nameSource,
      rank: answer.rank,
      rankSource: answer.rankSource,
      year: answer.year,
      yearSource: answer.yearSource,
      institute: answer.institute,
      instituteSource: answer.instituteSource,
      marks: answer.marksObtained,
      marksSource: answer.marksSource,
      sourceDriveId: answer.sourceDriveId,
      sourceUrl: answer.sourceUrl,
      sourceAvailable: answer.sourceAvailable,
      sourceStatus: answer.sourceStatus,
      linkSource: answer.linkSource,
      originalFilename: answer.originalFilename,
      cleanFilename: answer.cleanFilename,
      pageRaw: answer.pageRaw,
      pageNormalized: answer.pageNormalized,
      pageSource: answer.pageSource,
      pageStatus: answer.pageStatus,
      pageCount: answer.pageCount,
      localPdfPath: answer.localPdfPath,
      summary: answer.summary,
      summaryStatus: answer.summaryStatus,
      summarySource: answer.summarySource,
      valueAdds: answer.valueAdds,
      assetMentions: ingest?.assetMentions || [],
      examinerRemarks: ingest?.examinerRemarks || "",
      extractionMode: ingest?.extractionMode || "local",
      confidence: ingest?.confidence ?? null,
      sourceWords: ingest?.pdf.totalWords ?? null,
      sourcePages: ingest?.pdf.pageCount ?? null,
      selectedPages: ingest?.selectedPages || [],
      primaryMatch: { questionId: answer.cardId, score: 100, elo: 2200, matchType: "exact", reasons: ["canonical sheet mapping"] },
      relatedMatches: [],
      searchText: "",
      duplicateKey: "",
    }, card, 0, answerTokens, cardTokenIndex.get(answer.cardId) || []);

    const answerTermCandidates = unique([
      ...answerSyllabus.flatMap((tag) => extractTokens(tag, 2)),
      ...answerKeywords.flatMap((keyword) => extractTokens(keyword, 2)),
      ...topicTags.flatMap((tag) => extractTokens(tag, 2)),
      ...extractTokens(answer.summary, 6),
      ...extractTokens(answer.extractedQuestion, 8),
      cleanKey(card.paper),
      cleanKey(card.category),
    ]);

    const relatedCandidateIds = new Set<string>();
    const subjectCandidates = [...(cardsBySubject.get(subject.key) || new Set<string>())];
    for (const candidateId of subjectCandidates.slice(0, 24)) {
      if (candidateId !== answer.cardId) relatedCandidateIds.add(candidateId);
    }
    for (const term of answerTermCandidates.slice(0, 6)) {
      for (const candidateId of termIndex.get(term) || []) {
        if (candidateId !== answer.cardId) relatedCandidateIds.add(candidateId);
        if (relatedCandidateIds.size >= 12) break;
      }
      if (relatedCandidateIds.size >= 12) break;
    }

    const relatedMatches = [...relatedCandidateIds]
      .slice(0, 8)
      .map((questionId) => {
        const candidate = cardById.get(questionId);
        if (!candidate) return null;
        const sharedSyllabus = intersection(answerSyllabus, candidate.syllabusTags).length;
        const sharedKeywords = intersection(answerKeywords, candidate.keywords).length;
        const baseScore = Math.min(24, sharedSyllabus * 10 + sharedKeywords * 5);
        const scored = matchConfidence({
          id: answer.answerId,
          questionId: answer.cardId,
          question: answer.extractedQuestion,
          paper: answer.paper,
          category: answer.cardCategory,
          estimatedYear: answer.estimatedYear,
          subjectKey: subject.key,
          subjectLabel: subject.label,
          syllabusTags: answerSyllabus,
          keywords: answerKeywords,
          topicTags,
          topperName: answer.topperName,
          nameStatus: answer.nameStatus,
          nameSource: answer.nameSource,
          rank: answer.rank,
          rankSource: answer.rankSource,
          year: answer.year,
          yearSource: answer.yearSource,
          institute: answer.institute,
          instituteSource: answer.instituteSource,
          marks: answer.marksObtained,
          marksSource: answer.marksSource,
          sourceDriveId: answer.sourceDriveId,
          sourceUrl: answer.sourceUrl,
          sourceAvailable: answer.sourceAvailable,
          sourceStatus: answer.sourceStatus,
          linkSource: answer.linkSource,
          originalFilename: answer.originalFilename,
          cleanFilename: answer.cleanFilename,
          pageRaw: answer.pageRaw,
          pageNormalized: answer.pageNormalized,
          pageSource: answer.pageSource,
          pageStatus: answer.pageStatus,
          pageCount: answer.pageCount,
          localPdfPath: answer.localPdfPath,
          summary: answer.summary,
          summaryStatus: answer.summaryStatus,
          summarySource: answer.summarySource,
          valueAdds: answer.valueAdds,
          assetMentions: ingest?.assetMentions || [],
          examinerRemarks: ingest?.examinerRemarks || "",
          extractionMode: ingest?.extractionMode || "local",
          confidence: ingest?.confidence ?? null,
          sourceWords: ingest?.pdf.totalWords ?? null,
          sourcePages: ingest?.pdf.pageCount ?? null,
          selectedPages: ingest?.selectedPages || [],
          primaryMatch: { questionId: answer.cardId, score: 100, elo: 2200, matchType: "exact", reasons: ["canonical sheet mapping"] },
          relatedMatches: [],
          searchText: "",
          duplicateKey: "",
        }, candidate, baseScore, answerTokens, cardTokenIndex.get(questionId) || []);
        return {
          questionId: candidate.id,
          score: scored.score,
          elo: scored.elo,
          matchType: scored.matchType,
          reasons: unique(scored.reasons).slice(0, 6),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => b.score - a.score || b.elo - a.elo || a.questionId.localeCompare(b.questionId));

    const bestMatches = relatedMatches.slice(0, 3);

    const vaultAnswer: VaultAnswer = {
      id: answer.answerId,
      questionId: answer.cardId,
      question: answer.extractedQuestion,
      paper: answer.paper,
      category: answer.cardCategory,
      estimatedYear: answer.estimatedYear,
      subjectKey: subject.key,
      subjectLabel: subject.label,
      syllabusTags: answerSyllabus,
      keywords: answerKeywords,
      topicTags,
      topperName: answer.topperName || "Anonymous topper",
      nameStatus: answer.nameStatus,
      nameSource: answer.nameSource,
      rank: answer.rank,
      rankSource: answer.rankSource,
      year: answer.year,
      yearSource: answer.yearSource,
      institute: answer.institute,
      instituteSource: answer.instituteSource,
      marks: answer.marksObtained,
      marksSource: answer.marksSource,
      sourceDriveId: answer.sourceDriveId,
      sourceUrl: answer.sourceUrl,
      sourceAvailable: answer.sourceAvailable,
      sourceStatus: answer.sourceStatus,
      linkSource: answer.linkSource,
      originalFilename: answer.originalFilename,
      cleanFilename: answer.cleanFilename,
      pageRaw: answer.pageRaw,
      pageNormalized: answer.pageNormalized,
      pageSource: answer.pageSource,
      pageStatus: answer.pageStatus,
      pageCount: answer.pageCount,
      localPdfPath: answer.localPdfPath,
      summary: answer.summary,
      summaryStatus: answer.summaryStatus,
      summarySource: answer.summarySource,
      valueAdds: answer.valueAdds,
      assetMentions: ingest?.assetMentions || [],
      examinerRemarks: ingest?.examinerRemarks || "",
      extractionMode: ingest?.extractionMode || "local",
      confidence: ingest?.confidence ?? null,
      sourceWords: ingest?.pdf.totalWords ?? null,
      sourcePages: ingest?.pdf.pageCount ?? null,
      selectedPages: ingest?.selectedPages || [],
      primaryMatch: {
        questionId: answer.cardId,
        score: primaryMatchScore.score,
        elo: primaryMatchScore.elo,
        matchType: primaryMatchScore.matchType,
        reasons: primaryMatchScore.reasons,
      },
      relatedMatches: topN(bestMatches.filter((match) => match.questionId !== answer.cardId), 3),
      searchText: "",
      duplicateKey: cleanKey([answer.sourceDriveId || answer.originalFilename || answer.answerId, answer.pageNormalized || answer.pageRaw || ""].join("|")),
    };
    vaultAnswer.searchText = buildAnswerSearchText(vaultAnswer, card, ingest);

    answers.push(vaultAnswer);
  }

  const duplicateReview: Array<{
    duplicateKey: string;
    keptAnswerId: string;
    droppedAnswerIds: string[];
    questionId: string;
    topperName: string;
    pageHint: number | string | null;
    sourceDriveId: string | null;
  }> = [];
  const dedupedAnswers: VaultAnswer[] = [];
  const dedupeMap = new Map<string, VaultAnswer>();

  for (const answer of answers) {
    const exactKey = cleanKey([
      answer.questionId,
      answer.topperName,
      answer.pageNormalized || answer.pageRaw || "",
      answer.sourceDriveId || answer.sourceUrl || answer.cleanFilename || answer.id,
    ].join("|"));
    const existing = dedupeMap.get(exactKey);
    if (!existing) {
      dedupeMap.set(exactKey, answer);
      dedupedAnswers.push(answer);
      continue;
    }

    const existingScore = Number(existing.sourceAvailable) * 1000 + existing.primaryMatch.score + (existing.confidence || 0);
    const nextScore = Number(answer.sourceAvailable) * 1000 + answer.primaryMatch.score + (answer.confidence || 0);
    const keep = nextScore > existingScore ? answer : existing;
    const drop = keep === answer ? existing : answer;

    dedupeMap.set(exactKey, keep);
    const index = dedupedAnswers.findIndex((item) => item.id === drop.id || item.id === keep.id);
    if (index >= 0) dedupedAnswers[index] = keep;
    duplicateReview.push({
      duplicateKey: exactKey,
      keptAnswerId: keep.id,
      droppedAnswerIds: [drop.id],
      questionId: keep.questionId,
      topperName: keep.topperName,
      pageHint: keep.pageNormalized || keep.pageRaw || null,
      sourceDriveId: keep.sourceDriveId,
    });
  }

  const answersByQuestion = new Map<string, VaultAnswer[]>();
  const answersBySubject = new Map<SubjectKey, VaultAnswer[]>();
  for (const answer of dedupedAnswers) {
    if (!answersByQuestion.has(answer.questionId)) answersByQuestion.set(answer.questionId, []);
    answersByQuestion.get(answer.questionId)!.push(answer);
    if (!answersBySubject.has(answer.subjectKey)) answersBySubject.set(answer.subjectKey, []);
    answersBySubject.get(answer.subjectKey)!.push(answer);
  }

  const questionRows: VaultQuestion[] = [];
  const syllabusStats = new Map<string, { subjectKey: SubjectKey; questionCount: number; answerCount: number; topperCount: number; topQuestions: Set<string>; topAnswers: Set<string> }>();
  const subjectStats = new Map<SubjectKey, { label: string; questionCount: number; answerCount: number; topperCount: number; topicCount: number; syllabusCount: number }>();

  for (const card of pyqData.cards) {
    const subject = classifySubject(card);
    const cardAnswers = (answersByQuestion.get(card.id) || [])
      .slice()
      .sort((a, b) => b.primaryMatch.score - a.primaryMatch.score || Number(b.sourceAvailable) - Number(a.sourceAvailable) || b.confidence! - a.confidence!);
    const topicTags = canonicalizeTopics([
      ...card.syllabusTags,
      ...card.keywords,
      ...cardAnswers.flatMap((answer) => answer.topicTags.slice(0, 4)),
    ]);
    const topAnswers = cardAnswers.slice(0, 6).map((answer) => ({
      answerId: answer.id,
      topperName: answer.topperName,
      rank: answer.rank,
      year: answer.year,
      institute: answer.institute,
      marks: answer.marks,
      pageHint: answer.pageNormalized,
      sourceAvailable: answer.sourceAvailable,
      sourceStatus: answer.sourceStatus,
      summary: summarize(answer.summary, 220),
      summarySource: answer.summarySource,
      valueAdds: topN(answer.valueAdds, 4),
      score: answer.primaryMatch.score,
      elo: answer.primaryMatch.elo,
    }));

    const questionRecord: VaultQuestion = {
      id: card.id,
      question: card.question,
      paper: card.paper,
      category: card.category,
      estimatedYear: card.estimatedYear,
      subjectKey: subject.key,
      subjectLabel: subject.label,
      syllabusTags: unique(card.syllabusTags),
      keywords: unique(card.keywords),
      topperCount: card.topperCount,
      answerCount: cardAnswers.length,
      sourceAvailableCount: cardAnswers.filter((answer) => answer.sourceAvailable).length,
      topicTags,
      topAnswers,
      searchText: buildQuestionSearchText(card, topicTags, cardAnswers),
    };
    questionRows.push(questionRecord);
    if (questionRows.length % 5000 === 0) {
      console.log(`Prepared ${questionRows.length.toLocaleString()} / ${pyqData.cards.length.toLocaleString()} questions`);
    }

    for (const tag of unique([...card.syllabusTags, ...card.keywords].map((value) => normalizeText(value)))) {
      if (!syllabusStats.has(tag)) syllabusStats.set(tag, { subjectKey: subject.key, questionCount: 0, answerCount: 0, topperCount: 0, topQuestions: new Set<string>(), topAnswers: new Set<string>() });
      const bucket = syllabusStats.get(tag)!;
      bucket.questionCount += 1;
      bucket.answerCount += cardAnswers.length;
      bucket.topperCount += card.topperCount;
      bucket.topQuestions.add(card.id);
      for (const answer of topAnswers.slice(0, 3)) bucket.topAnswers.add(answer.answerId);
    }

    if (!subjectStats.has(subject.key)) subjectStats.set(subject.key, { label: subject.label, questionCount: 0, answerCount: 0, topperCount: 0, topicCount: 0, syllabusCount: 0 });
    const subjectBucket = subjectStats.get(subject.key)!;
    subjectBucket.questionCount += 1;
    subjectBucket.answerCount += cardAnswers.length;
    subjectBucket.topperCount += card.topperCount;
    subjectBucket.topicCount += topicTags.length;
    subjectBucket.syllabusCount += card.syllabusTags.length;
  }

  const subjects: VaultSubject[] = [...subjectStats.entries()]
    .map(([subjectKey, stats]) => ({
      subjectKey,
      subjectLabel: stats.label,
      questionCount: stats.questionCount,
      answerCount: stats.answerCount,
      topperCount: stats.topperCount,
      topicCount: stats.topicCount,
      syllabusCount: stats.syllabusCount,
      searchText: searchText(subjectKey, stats.label),
    }))
    .sort((a, b) => b.answerCount - a.answerCount || a.subjectLabel.localeCompare(b.subjectLabel));

  const syllabi: VaultSyllabus[] = [...syllabusStats.entries()]
    .map(([name, stats]) => ({
      name,
      subjectKey: stats.subjectKey,
      questionCount: stats.questionCount,
      answerCount: stats.answerCount,
      topperCount: stats.topperCount,
      topQuestions: [...stats.topQuestions].slice(0, 12),
      topAnswers: [...stats.topAnswers].slice(0, 12),
    }))
    .sort((a, b) => b.answerCount - a.answerCount || a.name.localeCompare(b.name))
    .slice(0, 1200);

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: {
      pyqs: pyqData.count,
      canonicalAnswers: canonical.count,
      toppers: toppers.length,
      ingestRun: latestRunPath ? path.basename(latestRunPath) : null,
      ingestRunMode: ingestRuns.at(-1)?.mode || null,
      ingestProcessed,
    },
    counts: {
      questions: questionRows.length,
      answers: dedupedAnswers.length,
      subjects: subjects.length,
      syllabi: syllabi.length,
      answersWithSource: dedupedAnswers.filter((answer) => answer.sourceAvailable).length,
      answersWithRank: dedupedAnswers.filter((answer) => answer.rank !== null).length,
      answersWithYear: dedupedAnswers.filter((answer) => answer.year !== null).length,
      answersWithPdfText: dedupedAnswers.filter((answer) => (answer.sourceWords || 0) > 0).length,
      answersWithTopicTags: dedupedAnswers.filter((answer) => answer.topicTags.length > 0).length,
      answersWithIngest: dedupedAnswers.filter((answer) => answer.sourceWords !== null).length,
      duplicateAnswersCollapsed: duplicateReview.length,
    },
    notes: [
      "One canonical row per topper copy.",
      "Primary PYQ mapping stays anchored to the sheet-derived cardId.",
      "Related matches are capped so the vault stays cheap and queryable.",
      "OCR/ingest data only enriches the canonical sheet row and does not replace it.",
    ],
  };

  fs.mkdirSync(VAULT_DIR, { recursive: true });
  fs.writeFileSync(path.join(VAULT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(VAULT_DIR, "subjects.json"), JSON.stringify(subjects));
  fs.writeFileSync(path.join(VAULT_DIR, "syllabi.json"), JSON.stringify(syllabi));
  fs.writeFileSync(path.join(VAULT_DIR, "questions.json"), JSON.stringify(questionRows));
  fs.writeFileSync(path.join(VAULT_DIR, "answers.json"), JSON.stringify(dedupedAnswers));
  fs.writeFileSync(path.join(VAULT_DIR, "duplicate-review.json"), JSON.stringify(duplicateReview, null, 2));
  fs.writeFileSync(path.join(VAULT_DIR, "search-index.json"), JSON.stringify({
    generatedAt: manifest.generatedAt,
    questions: questionRows.map((question) => ({
      kind: "question",
      id: question.id,
      subjectKey: question.subjectKey,
      subjectLabel: question.subjectLabel,
      paper: question.paper,
      category: question.category,
      estimatedYear: question.estimatedYear,
      topicTags: question.topicTags,
      searchText: question.searchText,
    })),
    answers: dedupedAnswers.map((answer) => ({
      kind: "answer",
      id: answer.id,
      questionId: answer.questionId,
      subjectKey: answer.subjectKey,
      subjectLabel: answer.subjectLabel,
      paper: answer.paper,
      category: answer.category,
      estimatedYear: answer.estimatedYear,
      topperName: answer.topperName,
      rank: answer.rank,
      year: answer.year,
      topicTags: answer.topicTags,
      searchText: answer.searchText,
    })),
  }));

  console.log(`Built vault db: ${dedupedAnswers.length.toLocaleString()} answers, ${questionRows.length.toLocaleString()} questions`);
  console.log(`Output: ${path.relative(ROOT, VAULT_DIR)}`);
}

build();

import { readFileSync } from "fs";
import { join } from "path";
import { APP_DATA_DIR } from "./paths";
import { isPublishableQuestionText, normalizePublicTopperName } from "./public-records";

export interface SearchDocumentRecord {
  answerId: string;
  questionId: string;
  question: string;
  paper: string;
  category: string;
  subjectKey: string;
  subjectLabel: string;
  attemptYear: number | null;
  rank: number | null;
  marksObtained: string | null;
  institute: string | null;
  topperName: string | null;
  syllabusPath: string[];
  topicTags: string[];
  valueAdds: string[];
  summary: string;
  primaryMatchScore: number;
  primaryMatchElo: number;
  pdfAvailable: boolean;
  pdfPage: number | null;
  sourceStatus: string;
  searchText: string;
}

export interface SearchQueryParams {
  q?: string;
  subject?: string;
  paper?: string;
  syllabus?: string;
  topic?: string;
  year?: number | null;
  topper?: string;
  limit?: number;
  cursor?: string | null;
}

type VaultAnswer = {
  id: string;
  questionId: string;
  question: string;
  paper: string;
  category: string;
  estimatedYear: number | null;
  subjectKey: string;
  subjectLabel: string;
  syllabusTags: string[];
  keywords: string[];
  topicTags: string[];
  topperName: string | null;
  rank: number | null;
  year: number | null;
  institute: string | null;
  marks: string | null;
  sourceAvailable: boolean;
  sourceStatus: string;
  pageNormalized: number | null;
  summary: string;
  valueAdds: string[];
  primaryMatch: {
    score: number;
    elo: number;
  };
  searchText: string;
};

type CanonicalAnswerRecord = {
  answerId: string;
  topperName?: string | null;
  rank?: number | null;
  year?: number | null;
  institute?: string | null;
  marksObtained?: string | null;
  sourceAvailable?: boolean;
  sourceStatus?: string | null;
  pageNormalized?: number | null;
};

type VaultQuestion = {
  id: string;
  question: string;
  paper: string;
  category: string;
  estimatedYear: number | null;
  subjectKey: string;
  subjectLabel: string;
  syllabusTags: string[];
  keywords: string[];
  topicTags: string[];
};

const VAULT_DB_DIR = join(APP_DATA_DIR, "vault", "db");
const SEARCH_FILE = join(VAULT_DB_DIR, "answers.json");
const QUESTIONS_FILE = join(VAULT_DB_DIR, "questions.json");
const SUBJECTS_FILE = join(VAULT_DB_DIR, "subjects.json");
const SYLLABI_FILE = join(VAULT_DB_DIR, "syllabi.json");
const CANONICAL_ANSWERS_FILE = join(APP_DATA_DIR, "topper-answer-canonical.json");

let cachedDocs: SearchDocumentRecord[] | null = null;
let cachedQuestions: Map<string, VaultQuestion> | null = null;
let cachedSubjects: Array<{ subjectKey: string; subjectLabel: string; questionCount: number; answerCount: number; topperCount: number; topicCount: number; syllabusCount: number }> | null = null;
let cachedSyllabi: Array<{ name: string; subjectKey: string; questionCount: number; answerCount: number; topperCount: number; topQuestions: string[]; topAnswers: string[] }> | null = null;

export function loadSearchDocuments() {
  if (cachedDocs) return cachedDocs;

  const answers = readJson<VaultAnswer[]>(SEARCH_FILE, []);
  const canonicalAnswers = readJson<{ records: CanonicalAnswerRecord[] }>(CANONICAL_ANSWERS_FILE, { records: [] }).records;
  const canonicalByAnswerId = new Map(canonicalAnswers.map((record) => [record.answerId, record]));
  cachedDocs = answers
    .map((answer) => {
      const canonical = canonicalByAnswerId.get(answer.id);
      return {
        ...answer,
        topperName: normalizePublicTopperName(canonical?.topperName ?? answer.topperName),
        rank: canonical?.rank ?? answer.rank,
        year: canonical?.year ?? answer.year,
        institute: canonical?.institute ?? answer.institute,
        marks: canonical?.marksObtained ?? answer.marks,
        sourceAvailable: canonical?.sourceAvailable ?? answer.sourceAvailable,
        sourceStatus: canonical?.sourceStatus ?? answer.sourceStatus,
        pageNormalized: canonical?.pageNormalized ?? answer.pageNormalized,
      };
    })
    .filter((answer) => answer.sourceAvailable && answer.primaryMatch?.elo >= 1400)
    .map((answer) => ({
      answerId: answer.id,
      questionId: answer.questionId,
      question: answer.question,
      paper: answer.paper,
      category: answer.category,
      subjectKey: answer.subjectKey,
      subjectLabel: answer.subjectLabel,
      attemptYear: answer.year ?? answer.estimatedYear ?? null,
      rank: answer.rank,
      marksObtained: answer.marks,
      institute: answer.institute,
      topperName: answer.topperName,
      syllabusPath: unique(answer.syllabusTags),
      topicTags: unique(answer.topicTags),
      valueAdds: unique(answer.valueAdds),
      summary: answer.summary,
      primaryMatchScore: answer.primaryMatch?.score ?? 0,
      primaryMatchElo: answer.primaryMatch?.elo ?? 0,
      pdfAvailable: answer.sourceAvailable,
      pdfPage: answer.pageNormalized,
      sourceStatus: answer.sourceStatus,
      searchText: normalize([answer.searchText, answer.question, answer.summary, answer.topperName, answer.institute, answer.syllabusTags.join(" "), answer.topicTags.join(" "), answer.valueAdds.join(" ")].join(" ")),
    }))
    .filter((answer) => isPublishableQuestionText(answer.question))
    .sort((a, b) => b.primaryMatchElo - a.primaryMatchElo || b.primaryMatchScore - a.primaryMatchScore || a.answerId.localeCompare(b.answerId));

  return cachedDocs;
}

export function loadQuestionIndex() {
  if (cachedQuestions) return cachedQuestions;
  const rows = readJson<VaultQuestion[]>(QUESTIONS_FILE, []);
  cachedQuestions = new Map(rows.map((row) => [row.id, row]));
  return cachedQuestions;
}

export function loadSubjectIndex() {
  if (cachedSubjects) return cachedSubjects;
  cachedSubjects = readJson(SUBJECTS_FILE, []);
  return cachedSubjects;
}

export function loadSyllabusIndex() {
  if (cachedSyllabi) return cachedSyllabi;
  cachedSyllabi = readJson(SYLLABI_FILE, []);
  return cachedSyllabi;
}

export function searchDocuments(params: SearchQueryParams) {
  const limit = clamp(params.limit ?? 24, 1, 60);
  const query = normalize(params.q || "");
  const cursor = params.cursor ? Number.parseInt(params.cursor, 10) : 0;
  const docs = loadSearchDocuments();

  const filtered = docs
    .filter((doc) => !params.subject || doc.subjectKey === normalizeSubjectKey(params.subject))
    .filter((doc) => !params.paper || normalize(doc.paper).includes(normalize(params.paper)))
    .filter((doc) => !params.syllabus || doc.syllabusPath.some((item) => normalize(item).includes(normalize(params.syllabus || ""))))
    .filter((doc) => !params.topic || doc.topicTags.some((item) => normalize(item).includes(normalize(params.topic || ""))))
    .filter((doc) => !params.topper || normalize(doc.topperName || "").includes(normalize(params.topper || "")))
    .filter((doc) => !params.year || doc.attemptYear === params.year);

  const scored = filtered
    .map((doc) => ({ doc, score: query ? scoreDocument(doc, query) : defaultScore(doc) }))
    .filter((item) => !query || item.score > 0.12)
    .sort((a, b) => b.score - a.score || b.doc.primaryMatchElo - a.doc.primaryMatchElo || a.doc.answerId.localeCompare(b.doc.answerId));

  const page = scored.slice(cursor, cursor + limit);
  const nextCursor = cursor + limit < scored.length ? String(cursor + limit) : null;

  return {
    total: scored.length,
    nextCursor,
    results: page.map((item) => ({
      ...item.doc,
      score: roundScore(item.score),
    })),
  };
}

export function getQuestionRecord(questionId: string) {
  return loadQuestionIndex().get(questionId) || null;
}

export function getAnswerRecord(answerId: string) {
  return loadSearchDocuments().find((doc) => doc.answerId === answerId) || null;
}

export function getSyllabusBySubject(subjectKey: string) {
  const key = normalizeSubjectKey(subjectKey);
  return loadSyllabusIndex()
    .filter((row) => row.subjectKey === key)
    .sort((a, b) => b.answerCount - a.answerCount || a.name.localeCompare(b.name));
}

export function getQuestionAnswers(questionId: string) {
  return loadSearchDocuments()
    .filter((doc) => doc.questionId === questionId)
    .sort((a, b) => b.primaryMatchElo - a.primaryMatchElo || b.primaryMatchScore - a.primaryMatchScore);
}

function scoreDocument(doc: SearchDocumentRecord, query: string) {
  const queryTokens = tokens(query);
  const textTokens = new Set(tokens(doc.searchText));
  const overlap = queryTokens.filter((token) => textTokens.has(token));
  const tokenRecall = overlap.length / Math.max(1, queryTokens.length);
  const exactBoost = normalize(doc.searchText).includes(query) ? 0.16 : 0;
  const fuzzyBoost = fuzzySimilarity(query, doc.searchText) * 0.22;
  const metadataBoost = Math.min(0.16, (doc.rank ? 0.05 : 0) + (doc.attemptYear ? 0.03 : 0) + (doc.institute ? 0.03 : 0) + Math.min(0.05, doc.valueAdds.length * 0.012));
  const authorityBoost = Math.min(0.14, doc.primaryMatchScore / 1000 + (doc.primaryMatchElo - 1400) / 9000);

  return tokenRecall * 0.44 + exactBoost + fuzzyBoost + metadataBoost + authorityBoost;
}

function defaultScore(doc: SearchDocumentRecord) {
  return Math.min(0.95, 0.2 + doc.primaryMatchScore / 120 + (doc.primaryMatchElo - 1400) / 5000);
}

function fuzzySimilarity(query: string, haystack: string) {
  if (!query || !haystack) return 0;
  const q = normalize(query);
  const h = normalize(haystack);
  if (!q || !h) return 0;
  if (h.includes(q)) return 1;

  const qTokens = unique(tokens(q));
  const hTokens = unique(tokens(h));
  const overlap = qTokens.filter((token) => hTokens.includes(token)).length;
  const jaccard = overlap / Math.max(1, qTokens.length + hTokens.length - overlap);
  return jaccard;
}

function normalizeSubjectKey(value: string) {
  return normalize(value).replace(/\s+/g, "").replace(/[^a-z0-9-]/g, "");
}

function normalize(value: string) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokens(value: string) {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function unique(values: string[]) {
  return [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function roundScore(value: number) {
  return Number(value.toFixed(4));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

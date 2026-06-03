/**
 * Server-side data loading.
 * Supports both legacy flat files and new relational entity files.
 */

import type { QuestionGroup, CategoriesMeta } from "./types";
import { readFileSync } from "fs";
import { join } from "path";
import { APP_DATA_DIR, APP_ENTITY_DIR } from "./paths";

const DATA_DIR = APP_DATA_DIR;
const ENTITY_DIR = APP_ENTITY_DIR;

let cachedQuestions: QuestionGroup[] | null = null;
let cachedCategories: CategoriesMeta | null = null;
let cachedKeywords: { keyword: string; count: number }[] | null = null;

export interface SafeQuestionListItem {
  id: number;
  question: string;
  syllabus_tags: string[];
  keywords: string[];
  category: string;
  derivedLinkCount: number;
  valueAddCount: number;
}

export function loadQuestions(): QuestionGroup[] {
  if (cachedQuestions) return cachedQuestions;
  const raw = readFileSync(join(DATA_DIR, "questions.json"), "utf-8");
  cachedQuestions = JSON.parse(raw) as QuestionGroup[];
  return cachedQuestions!;
}

export function loadCategoriesMeta(): CategoriesMeta {
  if (cachedCategories) return cachedCategories;
  const raw = readFileSync(join(DATA_DIR, "categories.json"), "utf-8");
  cachedCategories = JSON.parse(raw) as CategoriesMeta;
  return cachedCategories!;
}

export function loadKeywords(): { keyword: string; count: number }[] {
  if (cachedKeywords) return cachedKeywords;
  const raw = readFileSync(join(DATA_DIR, "keywords.json"), "utf-8");
  cachedKeywords = JSON.parse(raw) as { keyword: string; count: number }[];
  return cachedKeywords!;
}

/** Prefer questions with extracted answer signals, without exposing source links. */
export function sortR2First(questions: QuestionGroup[]): QuestionGroup[] {
  return [...questions].sort((a, b) => {
    const aSignals = a.toppers.reduce((sum, topper) => sum + (topper.value_adds?.length || 0), 0);
    const bSignals = b.toppers.reduce((sum, topper) => sum + (topper.value_adds?.length || 0), 0);
    if (aSignals !== bSignals) return bSignals - aSignals;
    return b.toppers.length - a.toppers.length;
  });
}

/** Load questions for a subject, filtered and R2-sorted. */
export function loadSubjectQuestions(subject: string): {
  questions: QuestionGroup[];
  total: number;
} {
  const all = loadQuestions();
  const filtered = filterQuestions(all, "", subject, null);
  const sorted = sortR2First(filtered);
  return { questions: sorted, total: sorted.length };
}

export function filterQuestions(
  questions: QuestionGroup[],
  search: string,
  category: string | null,
  keyword: string | null,
): QuestionGroup[] {
  let result = questions;

  // ── Category filter ──
  if (category && category !== "all") {
    const catLower = category.toLowerCase();
    result = result.filter((q) => {
      const qCat = q.category.toLowerCase();
      if (catLower === "gs 1") return qCat === "gs 1" || qCat === "history";
      if (catLower === "gs 2") return qCat === "gs 2";
      if (catLower === "gs 3") return qCat === "gs 3";
      if (catLower === "gs 4") return qCat === "gs 4";
      if (catLower === "essay") return qCat === "essay";
      if (catLower === "optionals") {
        return [
          "geography",
          "sociology",
          "psir",
          "public administration",
          "anthropology",
        ].includes(qCat);
      }
      return qCat === catLower;
    });
  }

  // ── Keyword filter ──
  if (keyword && keyword.trim()) {
    const kw = keyword.toLowerCase().trim();
    result = result.filter((q) =>
      (q.keywords || []).some((k) => k.toLowerCase() === kw),
    );
  }

  // ── Deep search ──
  if (search && search.trim()) {
    const q = search.toLowerCase().trim();
    result = result.filter((group) => {
      if (group.question.toLowerCase().includes(q)) return true;
      if (group.syllabus_tags.some((s) => s.toLowerCase().includes(q)))
        return true;
      if ((group.keywords || []).some((k) => k.toLowerCase().includes(q)))
        return true;
      return group.toppers.some((t) =>
        t.value_adds.some(
          (va) =>
            va.type.toLowerCase().includes(q) ||
            va.value.toLowerCase().includes(q),
        ),
      );
    });
  }

  return result;
}

export function isDisplayableQuestion(question: QuestionGroup): boolean {
  const text = question.question
    .replace(/^\s*(?:Q\.?\s*)?\d{1,2}\s*(?:[.)]|\([a-e]\)|[a-e][.)])?\s*/i, "")
    .replace(/[\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < 12) return false;
  if (/^(?:na|qna|n\/a|null|undefined)(?:\s+na)?$/i.test(text)) return false;
  return text.split(/\s+/).filter(Boolean).length >= 3;
}

export function toSafeQuestionListItem(question: QuestionGroup): SafeQuestionListItem {
  return {
    id: question.id,
    question: cleanStudyText(question.question),
    syllabus_tags: uniqueClean(question.syllabus_tags).slice(0, 6),
    keywords: uniqueClean(question.keywords).slice(0, 8),
    category: question.category,
    derivedLinkCount: question.toppers.length,
    valueAddCount: question.toppers.reduce((sum, topper) => sum + (topper.value_adds?.length || 0), 0),
  };
}

function uniqueClean(values: string[]) {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const value of values || []) {
    const item = cleanStudyText(value);
    if (!item || /^(?:na|n\/a|not mentioned|no diagram|other|page\s+\d+)$/i.test(item)) continue;
    if (seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    clean.push(item);
  }
  return clean;
}

function cleanStudyText(value: string) {
  return String(value || "")
    .replace(/[\w ()-]*\.pdf\b/gi, "")
    .replace(/\bdrive_[A-Za-z0-9_-]+\b/g, "")
    .replace(/\b\d{9,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// Relational Entity Loaders (new entity-based data)
// ═══════════════════════════════════════════════════════════════════════════

export interface TopperEntity {
  id: string;
  displayName: string;
  aliases: string[];
  rank: number | null;
  year: number | null;
  optionalSubject: string | null;
  gsMarks: string | null;
  answerCount: number;
  questionIds: number[];
  driveIds: string[];
}

export interface QuestionEntity {
  id: number;
  canonicalText: string;
  rawText: string;
  year: number | null;
  subject: string;
  paper: string;
  marks: number | null;
  syllabusTags: string[];
  themeIds: string[];
  topperAnswerCount: number;
}

export interface TopperAnswerEntity {
  id: string;
  topperId: string;
  questionId: number;
  driveId: string | null;
  pageNumber: number | null;
  introduction: string | null;
  ocrSummary: string | null;
  valueAdds: { type: string; value: string }[];
  marksObtained: string | null;
  linkType: "r2-cdn" | "google-drive" | "none";
  cdnUrl: string | null;
  rawFilename: string;
}

export interface ThemeEntity {
  id: string;
  name: string;
  questionCount: number;
  subjects: string[];
  crossSubjectLinks: string[];
}

let cachedToppers: TopperEntity[] | null = null;
let cachedQuestionsEntity: QuestionEntity[] | null = null;
let cachedThemesEntity: ThemeEntity[] | null = null;
let cachedTopperNameIndex: Record<string, string> | null = null;
let cachedTopperQuestionIndex: Record<string, number[]> | null = null;

export function loadToppers(): TopperEntity[] {
  if (cachedToppers) return cachedToppers;
  try {
    const raw = readFileSync(join(ENTITY_DIR, "toppers.json"), "utf-8");
    cachedToppers = JSON.parse(raw);
  } catch { cachedToppers = []; }
  return cachedToppers!;
}

export function loadQuestionsEntity(): QuestionEntity[] {
  if (cachedQuestionsEntity) return cachedQuestionsEntity;
  try {
    const raw = readFileSync(join(ENTITY_DIR, "questions.json"), "utf-8");
    cachedQuestionsEntity = JSON.parse(raw);
  } catch { cachedQuestionsEntity = []; }
  return cachedQuestionsEntity!;
}

export function loadThemesEntity(): ThemeEntity[] {
  if (cachedThemesEntity) return cachedThemesEntity;
  try {
    const raw = readFileSync(join(ENTITY_DIR, "themes.json"), "utf-8");
    cachedThemesEntity = JSON.parse(raw);
  } catch { cachedThemesEntity = []; }
  return cachedThemesEntity!;
}

export function loadTopperNameIndex(): Record<string, string> {
  if (cachedTopperNameIndex) return cachedTopperNameIndex;
  try {
    const raw = readFileSync(join(ENTITY_DIR, "topper-name-index.json"), "utf-8");
    cachedTopperNameIndex = JSON.parse(raw);
  } catch { cachedTopperNameIndex = {}; }
  return cachedTopperNameIndex!;
}

export function loadTopperQuestionIndex(): Record<string, number[]> {
  if (cachedTopperQuestionIndex) return cachedTopperQuestionIndex;
  try {
    const raw = readFileSync(join(ENTITY_DIR, "topper-question-index.json"), "utf-8");
    cachedTopperQuestionIndex = JSON.parse(raw);
  } catch { cachedTopperQuestionIndex = {}; }
  return cachedTopperQuestionIndex!;
}

/** Find a topper by name (case-insensitive partial match) */
export function findTopperByName(name: string): TopperEntity | null {
  const index = loadTopperNameIndex();
  const key = name.toLowerCase().trim();
  const topperId = index[key];
  if (!topperId) return null;
  const toppers = loadToppers();
  return toppers.find((t) => t.id === topperId) || null;
}

/** Get all answers for a specific question, with topper metadata */
export function getAnswersForQuestion(
  questionId: number,
): (TopperAnswerEntity & { topperName: string; topperRank: number | null })[] {
  // This reads the large topper-answers.json — use with pagination in production
  try {
    const raw = readFileSync(join(ENTITY_DIR, "topper-answers.json"), "utf-8");
    const allAnswers: TopperAnswerEntity[] = JSON.parse(raw);
    const toppers = loadToppers();
    const topperMap = new Map(toppers.map((t) => [t.id, t]));

    return allAnswers
      .filter((a) => a.questionId === questionId)
      .map((a) => {
        const t = topperMap.get(a.topperId);
        return {
          ...a,
          topperName: t?.displayName || a.topperId,
          topperRank: t?.rank || null,
        };
      });
  } catch {
    return [];
  }
}

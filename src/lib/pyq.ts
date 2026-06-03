import { readFileSync } from "fs";
import { join } from "path";
import { APP_DATA_DIR } from "./paths";

export interface SubjectPyqCard {
  id: string;
  question: string;
  paper: string;
  category: string;
  estimatedYear: number | null;
  marks: number | null;
  syllabusTags: string[];
  keywords: string[];
  topperCount: number;
  relevantQuestionCount: number;
  relevantQuestions: RelevantQuestion[];
}

export interface RelevantQuestion {
  id: string;
  question: string;
  paper: string;
  category: string;
  syllabusTags: string[];
  keywords: string[];
  matchType: string;
  matchConfidence: number;
  matchReason: string;
  reviewStatus: "published" | "needs_review";
  topperCount: number;
  sourceAvailableCount: number;
  topperCopies: TopperCopy[];
}

export interface TopperCopy {
    answerId: string;
    sourceAvailable: boolean;
    sourceStatus?: string;
    topperName: string;
    nameStatus?: string;
    rank: number | null;
    year: number | null;
    institute: string | null;
    marks: string | number | null;
    interpretation: string;
    summaryStatus?: string;
    valueAdds: string[];
    pageHint: number | null;
    pageStatus?: "valid" | "missing" | "fallback" | "out_of_range";
    matchType?: string;
    matchConfidence?: number;
    matchedQuestion?: string;
}

interface SafePyqCard {
  id: string;
  question: string;
  paper: string;
  category: string;
  estimatedYear: number | null;
  marks?: number | null;
  syllabusTags: string[];
  keywords: string[];
  topperCount: number;
  relevantQuestionCount?: number;
  relevantQuestions?: RelevantQuestion[];
  linkedInsights?: TopperCopy[];
}

interface SafePyqDataset {
  generatedAt: string;
  count: number;
  cards: SafePyqCard[];
}

let cachedDataset: SafePyqDataset | null = null;

export const SUBJECT_ROUTES: Record<string, { label: string; categories: string[]; papers: string[] }> = {
  gs1: { label: "GS Paper I", categories: ["GS 1", "History"], papers: ["GS-1", "GS 1"] },
  gs2: { label: "GS Paper II", categories: ["GS 2"], papers: ["GS-2", "GS 2"] },
  gs3: { label: "GS Paper III", categories: ["GS 3"], papers: ["GS-3", "GS 3"] },
  gs4: { label: "GS Paper IV", categories: ["GS 4"], papers: ["GS-4", "GS 4"] },
  essay: { label: "Essay", categories: ["Essay"], papers: ["Essay"] },
  geography: { label: "Geography Optional", categories: ["Geography"], papers: ["Geography"] },
  sociology: { label: "Sociology Optional", categories: ["Sociology"], papers: ["Sociology"] },
  psir: { label: "PSIR Optional", categories: ["PSIR"], papers: ["PSIR"] },
  "public-administration": { label: "Public Administration Optional", categories: ["Public Administration"], papers: ["Public Administration"] },
  anthropology: { label: "Anthropology Optional", categories: ["Anthropology"], papers: ["Anthropology"] },
};

export function loadPyqDataset(): SafePyqDataset {
  if (cachedDataset) return cachedDataset;
  try {
    cachedDataset = JSON.parse(readFileSync(join(APP_DATA_DIR, "public-pyqs.json"), "utf-8")) as SafePyqDataset;
  } catch {
    cachedDataset = { generatedAt: "", count: 0, cards: [] };
  }
  return cachedDataset;
}

export function getSubjectPyqs(subjectKey: string, query = "", limit = 80): SubjectPyqCard[] {
  const config = SUBJECT_ROUTES[subjectKey];
  if (!config) return [];

  const q = query.trim().toLowerCase();
  const cards = loadPyqDataset().cards
    .filter((card) => matchesSubject(card, config))
    .filter((card) => !q || searchableText(card).includes(q))
    .slice(0, limit);

  return cards.map((card) => ({
    ...card,
    marks: card.marks ?? null,
    relevantQuestionCount: card.relevantQuestionCount ?? card.relevantQuestions?.length ?? 0,
    relevantQuestions: card.relevantQuestions ?? [],
  }));
}

function matchesSubject(card: SafePyqCard, config: typeof SUBJECT_ROUTES[string]) {
  const haystack = `${card.paper} ${card.category} ${card.question}`.toLowerCase();
  return config.papers.some((paper) => card.paper.toLowerCase() === paper.toLowerCase())
    || config.categories.some((category) => haystack.includes(category.toLowerCase()));
}

function searchableText(card: SafePyqCard) {
  return [
    card.question,
    card.paper,
    card.category,
    card.keywords.join(" "),
    card.syllabusTags.join(" "),
  ].join(" ").toLowerCase();
}

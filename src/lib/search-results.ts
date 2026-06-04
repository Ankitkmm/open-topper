import { normalizePublicTopperName } from "./public-records";
import type { SearchAnswerCard } from "./search-api";

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
  topperName: string | null;
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

export function groupAnswerCards(docs: SearchAnswerCard[], limit = 240, fallbackCategory = ""): SubjectPyqCard[] {
  const grouped = new Map<string, SubjectPyqCard>();

  for (const doc of docs) {
    const topperCopy: TopperCopy = {
      answerId: doc.answerId,
      sourceAvailable: doc.pdfAvailable,
      sourceStatus: doc.sourceStatus,
      topperName: normalizePublicTopperName(doc.topperName),
      rank: doc.rank,
      year: doc.attemptYear,
      institute: doc.institute,
      marks: doc.marksObtained,
      interpretation: doc.summary,
      summaryStatus: "available",
      valueAdds: doc.valueAdds,
      pageHint: doc.pdfPage,
      pageStatus: semanticPageStatus(doc.pageStatus, doc.pdfPage),
      matchType: "semantic",
      matchConfidence: doc.score ?? 0,
      matchedQuestion: doc.question,
    };

    const relevantQuestion: RelevantQuestion = {
      id: `${doc.questionId}_${doc.answerId}`,
      question: doc.question,
      paper: doc.paper,
      category: doc.category || doc.subjectLabel || fallbackCategory,
      syllabusTags: doc.syllabusPath,
      keywords: doc.topicTags,
      matchType: "semantic",
      matchConfidence: doc.score ?? 0,
      matchReason: `Primary match ELO ${doc.primaryMatchElo}`,
      reviewStatus: "published",
      topperCount: 1,
      sourceAvailableCount: doc.pdfAvailable ? 1 : 0,
      topperCopies: [topperCopy],
    };

    const existing = grouped.get(doc.questionId);
    if (existing) {
      existing.topperCount += 1;
      existing.relevantQuestionCount += 1;
      existing.relevantQuestions.push(relevantQuestion);
      continue;
    }

    grouped.set(doc.questionId, {
      id: doc.questionId,
      question: doc.question,
      paper: doc.paper,
      category: doc.category || doc.subjectLabel || fallbackCategory,
      estimatedYear: doc.attemptYear,
      marks: extractMarks(doc.question),
      syllabusTags: doc.syllabusPath,
      keywords: doc.topicTags,
      topperCount: 1,
      relevantQuestionCount: 1,
      relevantQuestions: [relevantQuestion],
    });
  }

  return [...grouped.values()].slice(0, limit);
}

function extractMarks(question: string) {
  const match = String(question || "").match(/\b(10|15|20|25|125|250)\s*marks?\b/i) || String(question || "").match(/\((10|15|20|25)\s*m/i);
  return match ? Number(match[1]) : null;
}

function semanticPageStatus(
  value: SearchAnswerCard["pageStatus"] | undefined,
  pdfPage: number | null,
): TopperCopy["pageStatus"] {
  if (value) return value;
  return pdfPage ? "valid" : "missing";
}

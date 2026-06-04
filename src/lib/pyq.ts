import {
  getSubjectDefinition,
  getSubjectDefinitions,
  getSubjectKeyFromValue,
  type SubjectKey,
} from "./subject-definitions";
import {
  getWorkspaceNode,
  getWorkspaceQuestionById,
  getSubjectWorkspaceQuestions,
  getWorkspaceStats,
  getWorkspaceSyllabusNodes,
  searchWorkspaceQuestions,
  type WorkspaceQuestion,
  type WorkspaceSyllabusNode,
} from "./question-bank";
import { searchAnswerCards } from "./db-search";
import { cleanPublicText, isPublishableQuestionText, normalizePublicTopperName } from "./public-records";
import type { SearchAnswerCard } from "./search-api";

export const SUBJECT_ROUTES = Object.fromEntries(
  getSubjectDefinitions().map((subject) => [
    subject.key,
    {
      key: subject.key,
      label: subject.title,
      shortLabel: subject.shortLabel,
      description: subject.description,
      href: subject.href,
      categories: subject.categoryLabels,
      paper: subject.paperLabel,
    },
  ]),
) as Record<SubjectKey, {
  key: SubjectKey;
  label: string;
  shortLabel: string;
  description: string;
  href: string;
  categories: string[];
  paper: string;
}>;

export async function getSubjectPyqs(
  subjectKey: SubjectKey,
  query = "",
  limit = 120,
  syllabusNodeId = "",
): Promise<WorkspaceQuestion[]> {
  if (query.trim()) {
    return searchHybridWorkspaceQuestions({
      query,
      subjectKey,
      syllabusNodeId,
      limit,
    });
  }
  return getSubjectWorkspaceQuestions(subjectKey, query, syllabusNodeId).slice(0, limit);
}

export async function getSubjectSyllabusNodes(subjectKey: SubjectKey): Promise<WorkspaceSyllabusNode[]> {
  return getWorkspaceSyllabusNodes(subjectKey);
}

export async function getBrowsePyqs(options: {
  query?: string;
  category?: string;
  syllabusNodeId?: string;
  limit?: number;
}) {
  const subjectKey = options.category ? getSubjectKeyFromValue(options.category) : null;
  if ((options.query || "").trim()) {
    return searchHybridWorkspaceQuestions({
      query: options.query || "",
      subjectKey: subjectKey || "",
      syllabusNodeId: options.syllabusNodeId || "",
      limit: options.limit || 160,
    });
  }

  return searchWorkspaceQuestions({
    query: options.query || "",
    subjectKey: subjectKey || "",
    syllabusNodeId: options.syllabusNodeId || "",
    limit: options.limit || 160,
  });
}

export async function getFeaturedSubjectQuestion(subjectKey: SubjectKey) {
  return getSubjectWorkspaceQuestions(subjectKey, "", "").find((question) => question.linkedInsights.length > 0) || null;
}

export async function getBrowseStats() {
  return getWorkspaceStats();
}

export function getSubjectPageMeta(subjectKey: SubjectKey) {
  return getSubjectDefinition(subjectKey);
}

export async function searchHybridWorkspaceQuestions(options: {
  query: string;
  subjectKey?: SubjectKey | "";
  syllabusNodeId?: string;
  limit: number;
}) {
  const syllabusLabel = options.syllabusNodeId
    ? getWorkspaceNode(options.syllabusNodeId)?.label || ""
    : "";
  const response = await searchAnswerCards({
    q: options.query,
    subject: options.subjectKey || undefined,
    syllabus: syllabusLabel || undefined,
    limit: options.limit,
  });

  return toWorkspaceQuestions(response.results, options.limit);
}

function toWorkspaceQuestions(docs: SearchAnswerCard[], limit: number) {
  const grouped = new Map<string, WorkspaceQuestion>();

  for (const doc of docs) {
    if (!isPublishableQuestionText(doc.question)) continue;

    const existingQuestion = getWorkspaceQuestionById(doc.questionId);
    const subjectKey = doc.subjectKey as SubjectKey;
    const subject = getSubjectDefinition(subjectKey);
    const question = grouped.get(doc.questionId) || {
      id: doc.questionId,
      question: existingQuestion?.question || cleanPublicText(doc.question),
      paper: existingQuestion?.paper || doc.paper,
      category: existingQuestion?.category || subject.title,
      subjectKey,
      subjectLabel: existingQuestion?.subjectLabel || doc.subjectLabel || subject.shortLabel,
      estimatedYear: existingQuestion?.estimatedYear ?? null,
      marks: existingQuestion?.marks ?? extractMarks(doc.question),
      syllabusNodeId: existingQuestion?.syllabusNodeId || "",
      syllabusPath: existingQuestion?.syllabusPath?.length ? existingQuestion.syllabusPath : doc.syllabusPath,
      linkedInsights: [],
      topperCount: 0,
      searchText: existingQuestion?.searchText || cleanPublicText(doc.question).toLowerCase(),
    } satisfies WorkspaceQuestion;

    if (question.linkedInsights.some((copy) => copy.answerId === doc.answerId)) {
      grouped.set(doc.questionId, question);
      continue;
    }

    question.linkedInsights.push({
      answerId: doc.answerId,
      topperName: normalizePublicTopperName(doc.topperName),
      rank: doc.rank,
      year: doc.attemptYear,
      institute: cleanPublicText(doc.institute || "") || null,
      marks: cleanPublicText(doc.marksObtained || "") || null,
      pageHint: doc.pdfPage,
      pageStatus: doc.pageStatus || null,
      sourceAvailable: doc.pdfAvailable,
      sourceStatus: doc.sourceStatus,
      summary: cleanPublicText(doc.summary),
      summaryAvailable: cleanPublicText(doc.summary).length >= 80,
      summarySource: cleanPublicText(doc.summary) ? "search" : null,
    });
    question.topperCount = question.linkedInsights.length;
    grouped.set(doc.questionId, question);
  }

  return [...grouped.values()].slice(0, limit);
}

function extractMarks(question: string) {
  const match = String(question || "").match(/\b(10|15|20|25|125|250)\s*marks?\b/i)
    || String(question || "").match(/\((10|15|20|25)\s*m/i);
  return match ? Number(match[1]) : null;
}

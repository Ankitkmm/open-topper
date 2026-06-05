import { getOfficialPyqStats } from "./official-pyqs";
import { getSubjectDefinition, type SubjectKey } from "./subject-definitions";
import { getSubjectWorkspaceQuestions, getWorkspaceSyllabusNodes } from "./question-bank-runtime";

export function getSubjectPageMeta(subjectKey: SubjectKey) {
  return getSubjectDefinition(subjectKey);
}

export async function getSubjectSyllabusNodes(subjectKey: SubjectKey) {
  return getWorkspaceSyllabusNodes(subjectKey);
}

export async function getFeaturedSubjectQuestion(subjectKey: SubjectKey) {
  return getSubjectWorkspaceQuestions(subjectKey, "", "").find((question) => question.linkedInsights.length > 0) || null;
}

export async function getBrowseStats() {
  const official = getOfficialPyqStats();
  return {
    totalQuestions: official.totalQuestions,
    answerLinks: official.linkedCopies,
    categoryCounts: new Map<string, number>(official.categories.map((row) => [row.name, row.count])),
  };
}

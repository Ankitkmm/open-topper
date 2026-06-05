import { getOfficialBrowsePyqs, getOfficialSubjectPyqShells } from "@/lib/official-pyqs";
import { getSubjectWorkspaceQuestions, type WorkspaceQuestion } from "@/lib/question-bank-runtime";
import { makeProgressItemId } from "@/lib/progress-items";
import type { SubjectKey } from "@/lib/subject-definitions";

export const INITIAL_BROWSE_SHELL_LIMIT = 240;
export const INITIAL_SUBJECT_SHELL_LIMIT = 1000;

export function getInitialOfficialBrowseShells(limit = INITIAL_BROWSE_SHELL_LIMIT) {
  return getOfficialBrowsePyqs("", "", "", limit);
}

export function getInitialOfficialSubjectShells(subjectKey: SubjectKey, limit = INITIAL_SUBJECT_SHELL_LIMIT) {
  return getOfficialSubjectPyqShells(subjectKey, "", limit, "");
}

export function getOfficialProgressQuestionIds(subjectKey: SubjectKey) {
  return getOfficialSubjectPyqShells(subjectKey, "", Number.MAX_SAFE_INTEGER, "")
    .map((question) => makeProgressItemId("pyq", question.id));
}

export async function getInitialWorkspaceSubjectShells(subjectKey: SubjectKey, limit = INITIAL_SUBJECT_SHELL_LIMIT) {
  return getSubjectWorkspaceQuestions(subjectKey, "", "")
    .slice(0, limit)
    .map((question) => ({ ...question, linkedInsights: [] }));
}

export function getSubjectProgressQuestionIds(subjectKey: SubjectKey) {
  return getSubjectWorkspaceQuestions(subjectKey)
    .map((question: WorkspaceQuestion) => makeProgressItemId("pyq", question.id));
}

import type { SubjectPyqCard } from "@/lib/search-results";
import type { WorkspaceQuestion } from "@/lib/question-bank-runtime";

export type ShellSearchDataset = "official" | "workspace";

export interface ShellSearchParams {
  dataset: ShellSearchDataset;
  subject?: string;
  questionId?: string;
  query?: string;
  syllabusId?: string;
  limit?: number;
  cursor?: string;
}

export interface ShellSearchResponse<T> {
  dataset: ShellSearchDataset;
  total: number;
  nextCursor: string | null;
  requestedLimit?: number;
  limit?: number;
  returnedCount?: number;
  truncated?: boolean;
  results: T[];
}

export type OfficialShellSearchResponse = ShellSearchResponse<SubjectPyqCard>;
export type WorkspaceShellSearchResponse = ShellSearchResponse<WorkspaceQuestion>;

export function buildShellSearchUrl({
  dataset,
  subject = "",
  questionId = "",
  query = "",
  syllabusId = "",
  limit,
  cursor = "",
}: ShellSearchParams) {
  const params = new URLSearchParams();
  params.set("dataset", dataset);
  if (subject.trim()) params.set("subject", subject.trim());
  if (questionId.trim()) params.set("questionId", questionId.trim());
  if (query.trim()) params.set("q", query.trim());
  if (syllabusId.trim()) params.set("syllabusId", syllabusId.trim());
  if (limit && Number.isFinite(limit)) params.set("limit", String(limit));
  if (cursor.trim()) params.set("cursor", cursor.trim());
  return `/api/search?${params.toString()}`;
}

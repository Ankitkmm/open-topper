"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OfficialSubjectWorkspace } from "@/components/OfficialSubjectWorkspace";
import { buildShellSearchUrl, type OfficialShellSearchResponse } from "@/lib/shell-search";
import type { SubjectPyqCard } from "@/lib/search-results";
import type { WorkspaceSyllabusNode } from "@/lib/question-bank-runtime";
import type { SubjectKey } from "@/lib/subject-definitions";

export function OfficialSubjectPageClient({
  subjectKey,
  title,
  description,
  initialQuestions,
  syllabusNodes,
  progressQuestionIds,
  baseHref,
}: {
  subjectKey: SubjectKey;
  title: string;
  description: string;
  initialQuestions: SubjectPyqCard[];
  syllabusNodes: WorkspaceSyllabusNode[];
  progressQuestionIds: string[];
  baseHref: string;
}) {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") || "";
  const selectedSyllabusId = searchParams.get("syllabus") || "";
  const focusedQuestionId = searchParams.get("question") || "";
  const shouldFetchFocusedQuestion = Boolean(
    focusedQuestionId && !initialQuestions.some((question) => question.id === focusedQuestionId),
  );
  const shouldFetchResults = Boolean(query.trim() || selectedSyllabusId || shouldFetchFocusedQuestion);
  const requestKey = `${subjectKey}\n${query}\n${selectedSyllabusId}\n${focusedQuestionId}`;
  const [resultState, setResultState] = useState<{
    key: string;
    questions: SubjectPyqCard[];
    notice: string | null;
    error: string | null;
    focusedMissing: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let focusedMissing = false;
      if (!query.trim() && !selectedSyllabusId) {
        let nextQuestions = initialQuestions;
        if (shouldFetchFocusedQuestion) {
          try {
            const detailResponse = await fetch(buildShellSearchUrl({
              dataset: "official",
              subject: subjectKey,
              questionId: focusedQuestionId,
              limit: 1,
            }), {
              cache: "no-store",
            });
            const detailPayload = await detailResponse.json() as OfficialShellSearchResponse | { error?: string };
            if (detailResponse.ok && "results" in detailPayload && detailPayload.results[0]) {
              nextQuestions = [detailPayload.results[0], ...initialQuestions];
            } else {
              focusedMissing = true;
            }
          } catch {
            focusedMissing = true;
          }
        }
        if (!cancelled) {
          setResultState({ key: requestKey, questions: nextQuestions, notice: null, error: null, focusedMissing });
        }
        return;
      }

      try {
        const response = await fetch(buildShellSearchUrl({
          dataset: "official",
          subject: subjectKey,
          query,
          syllabusId: selectedSyllabusId,
          limit: 1000,
        }), {
          cache: "no-store",
        });
        const payload = await response.json() as OfficialShellSearchResponse | { error?: string };
        if (!response.ok || !("results" in payload) || cancelled) {
          throw new Error("PYQs could not be loaded.");
        }
        let nextQuestions = payload.results;
        const notice = payload.truncated && payload.limit
          ? `Showing first ${payload.limit.toLocaleString()} matches. Add more words to narrow results.`
          : null;
        if (focusedQuestionId && !nextQuestions.some((question) => question.id === focusedQuestionId)) {
          try {
            const detailResponse = await fetch(buildShellSearchUrl({
              dataset: "official",
              subject: subjectKey,
              questionId: focusedQuestionId,
              limit: 1,
            }), {
              cache: "no-store",
            });
            const detailPayload = await detailResponse.json() as OfficialShellSearchResponse | { error?: string };
            if (detailResponse.ok && "results" in detailPayload && detailPayload.results[0]) {
              nextQuestions = [detailPayload.results[0], ...nextQuestions];
            } else {
              focusedMissing = true;
            }
          } catch {
            focusedMissing = true;
          }
        }
        if (!cancelled) {
          setResultState({ key: requestKey, questions: nextQuestions, notice, error: null, focusedMissing });
        }
      } catch {
        if (!cancelled) {
          setResultState({
            key: requestKey,
            questions: [],
            notice: null,
            error: "PYQs could not be loaded. Try again in a moment.",
            focusedMissing: false,
          });
        }
      }
    }

    if (shouldFetchResults) {
      void load();
    }
    return () => {
      cancelled = true;
    };
  }, [focusedQuestionId, initialQuestions, query, requestKey, selectedSyllabusId, shouldFetchFocusedQuestion, shouldFetchResults, subjectKey]);

  const activeResult = resultState?.key === requestKey ? resultState : null;
  const questions = useMemo(
    () => shouldFetchResults ? (activeResult?.questions ?? []) : initialQuestions,
    [activeResult, initialQuestions, shouldFetchResults],
  );

  const workspaceKey = useMemo(
    () => `${subjectKey}:${query}:${selectedSyllabusId}:${focusedQuestionId}:${questions[0]?.id || ""}:${questions.length}`,
    [focusedQuestionId, query, questions, selectedSyllabusId, subjectKey],
  );

  return (
    <OfficialSubjectWorkspace
      key={workspaceKey}
      subjectKey={subjectKey}
      title={title}
      description={description}
      questions={questions}
      syllabusNodes={syllabusNodes}
      query={query}
      selectedSyllabusId={selectedSyllabusId}
      focusedQuestionId={focusedQuestionId}
      progressQuestionIds={progressQuestionIds}
      baseHref={baseHref}
      isLoadingResults={shouldFetchResults && !activeResult}
      resultNotice={activeResult?.notice ?? null}
      queryError={activeResult?.error ?? null}
      focusedQuestionMissing={activeResult?.focusedMissing ?? false}
    />
  );
}

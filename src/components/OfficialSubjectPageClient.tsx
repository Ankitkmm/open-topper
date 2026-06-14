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
  const [fetchedQuestions, setFetchedQuestions] = useState<SubjectPyqCard[] | null>(null);
  const shouldFetchFocusedQuestion = Boolean(
    focusedQuestionId && !initialQuestions.some((question) => question.id === focusedQuestionId),
  );
  const shouldFetchResults = Boolean(query.trim() || selectedSyllabusId || shouldFetchFocusedQuestion);

  useEffect(() => {
    let cancelled = false;

    async function load() {
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
            }
          } catch {
            // Keep the static shell if the deep-link lookup fails.
          }
        }
        if (!cancelled) setFetchedQuestions(nextQuestions);
        return;
      }

      try {
        const response = await fetch(buildShellSearchUrl({
          dataset: "official",
          subject: subjectKey,
          query,
          syllabusId: selectedSyllabusId,
          limit: 120,
        }), {
          cache: "no-store",
        });
        const payload = await response.json() as OfficialShellSearchResponse | { error?: string };
        if (!response.ok || !("results" in payload) || cancelled) return;
        let nextQuestions = payload.results;
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
            }
          } catch {
            // Keep the search results if the deep-link lookup fails.
          }
        }
        if (!cancelled) setFetchedQuestions(nextQuestions);
      } catch {
        if (!cancelled) setFetchedQuestions([]);
      }
    }

    if (shouldFetchResults) {
      void load();
    }
    return () => {
      cancelled = true;
    };
  }, [focusedQuestionId, initialQuestions, query, selectedSyllabusId, shouldFetchFocusedQuestion, shouldFetchResults, subjectKey]);

  const questions = shouldFetchResults ? (fetchedQuestions ?? initialQuestions) : initialQuestions;

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
    />
  );
}

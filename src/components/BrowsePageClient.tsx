"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OfficialQuestionCards } from "@/components/OfficialQuestionCards";
import { buildShellSearchUrl, type OfficialShellSearchResponse } from "@/lib/shell-search";
import type { SubjectPyqCard } from "@/lib/search-results";

export function BrowsePageClient({
  initialQuestions,
}: {
  initialQuestions: SubjectPyqCard[];
}) {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") || "";
  const category = searchParams.get("category") || "";
  const shouldFetch = Boolean(query.trim() || category.trim());
  const requestKey = `${query}\n${category}`;
  const [resultState, setResultState] = useState<{
    key: string;
    questions: SubjectPyqCard[];
    notice: string | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!shouldFetch) return;

    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(buildShellSearchUrl({
          dataset: "official",
          query,
          subject: category,
          limit: 240,
        }), {
          cache: "no-store",
        });
        const payload = await response.json() as OfficialShellSearchResponse | { error?: string };
        if (!response.ok || !("results" in payload)) {
          throw new Error("Search results could not be loaded.");
        }
        if (!cancelled) {
          setResultState({
            key: requestKey,
            questions: payload.results,
            notice: payload.truncated && payload.limit
              ? `Showing first ${payload.limit.toLocaleString()} matches. Add more words to narrow results.`
              : null,
            error: null,
          });
        }
      } catch {
        if (!cancelled) {
          setResultState({
            key: requestKey,
            questions: [],
            notice: null,
            error: "Search results could not be loaded. Try again in a moment.",
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [category, query, requestKey, shouldFetch]);

  const activeResult = resultState?.key === requestKey ? resultState : null;
  const questions = shouldFetch ? (activeResult?.questions ?? []) : initialQuestions;

  return (
    <OfficialQuestionCards
      questions={questions}
      totalFiltered={questions.length}
      searchParams={{ q: query, category }}
      isLoadingResults={shouldFetch && !activeResult}
      resultNotice={activeResult?.notice ?? null}
      queryError={activeResult?.error ?? null}
    />
  );
}

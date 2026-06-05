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
  const [fetchedQuestions, setFetchedQuestions] = useState<SubjectPyqCard[] | null>(null);
  const shouldFetch = Boolean(query.trim() || category.trim());

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
        if (!response.ok || !("results" in payload)) return;
        if (!cancelled) setFetchedQuestions(payload.results);
      } catch {
        if (!cancelled) setFetchedQuestions([]);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [category, query, shouldFetch]);

  const questions = shouldFetch ? (fetchedQuestions ?? initialQuestions) : initialQuestions;

  return (
    <OfficialQuestionCards
      questions={questions}
      totalFiltered={questions.length}
      searchParams={{ q: query, category }}
    />
  );
}

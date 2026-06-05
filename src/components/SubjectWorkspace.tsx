"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, Loader2, Search, Sparkles } from "lucide-react";
import { useUserData } from "@/components/auth/UserDataProvider";
import { StudyNav } from "@/components/StudyNav";
import { ProgressToggle } from "./ProgressToggle";
import { SubjectProgress } from "./SubjectProgress";
import { type SubjectKey } from "@/lib/subject-definitions";
import type { WorkspaceQuestion, WorkspaceSyllabusNode } from "@/lib/question-bank";
import { normalizePublicTopperName } from "@/lib/public-records";
import { makeProgressItemId, progressItemCandidates, type ProgressItemType } from "@/lib/progress-items";

interface SubjectWorkspaceProps {
  subjectKey: SubjectKey;
  title: string;
  description: string;
  questions: WorkspaceQuestion[];
  syllabusNodes: WorkspaceSyllabusNode[];
  query?: string;
  selectedSyllabusId?: string;
  progressQuestionIds?: string[];
  baseHref: string;
}

export function SubjectWorkspace(props: SubjectWorkspaceProps) {
  const searchParams = useSearchParams();

  return (
    <SubjectWorkspaceView
      {...props}
      live
      query={searchParams.get("q") || ""}
      selectedSyllabusId={searchParams.get("syllabus") || ""}
    />
  );
}

export function SubjectWorkspaceFallback(props: SubjectWorkspaceProps) {
  return <SubjectWorkspaceView {...props} live={false} />;
}

function SubjectWorkspaceView({
  subjectKey,
  title,
  description,
  questions: initialQuestions,
  syllabusNodes,
  query = "",
  selectedSyllabusId = "",
  progressQuestionIds,
  baseHref,
  live,
}: SubjectWorkspaceProps & { live: boolean }) {
  const router = useRouter();
  const { authAvailable, isAuthenticated, progressMap, trackActivity } = useUserData();
  const [isPending, startTransition] = useTransition();
  const [openQuestions, setOpenQuestions] = useState<Set<string>>(new Set());
  const [detailsById, setDetailsById] = useState<Map<string, WorkspaceQuestion>>(new Map());
  const [loadingQuestions, setLoadingQuestions] = useState<Set<string>>(new Set());
  const [questionErrors, setQuestionErrors] = useState<Map<string, string>>(new Map());
  const [openSummaries, setOpenSummaries] = useState<Set<string>>(new Set());
  const [loadingAnswer, setLoadingAnswer] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [visibleQuestions, setVisibleQuestions] = useState<WorkspaceQuestion[]>(() => filterWorkspaceQuestions(initialQuestions, ""));
  const [draftQuery, setDraftQuery] = useState(query);
  const activeTopicRef = useRef<HTMLButtonElement | null>(null);

  const groupNodes = useMemo(
    () => syllabusNodes.filter((node) => node.kind === "group"),
    [syllabusNodes],
  );
  const topicNodes = useMemo(
    () => syllabusNodes.filter((node) => node.kind === "topic"),
    [syllabusNodes],
  );
  const topperCount = useMemo(
    () => visibleQuestions.reduce((sum, question) => sum + question.topperCount, 0),
    [visibleQuestions],
  );
  const activeGroupId = useMemo(() => {
    if (!selectedSyllabusId) return null;
    return topicNodes.find((node) => node.id === selectedSyllabusId)?.parentId ?? null;
  }, [selectedSyllabusId, topicNodes]);

  useEffect(() => {
    activeTopicRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedSyllabusId]);

  useEffect(() => {
    setDraftQuery(query);
  }, [query]);

  useEffect(() => {
    if (!live) {
      setVisibleQuestions(filterWorkspaceQuestions(initialQuestions, selectedSyllabusId));
      return;
    }

    if (!query.trim() && !selectedSyllabusId) {
      setResultsError(null);
      setIsLoadingResults(false);
      setVisibleQuestions(initialQuestions);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ dataset: "workspace", subject: subjectKey, limit: "1000" });
    if (query.trim()) params.set("q", query.trim());
    if (selectedSyllabusId) params.set("syllabusId", selectedSyllabusId);

    setIsLoadingResults(true);
    setResultsError(null);

    void fetch(`/api/search?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || "Search results could not be loaded.");
        }
        setVisibleQuestions(Array.isArray(payload?.results) ? (payload.results as WorkspaceQuestion[]) : []);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setResultsError(error instanceof Error ? error.message : "Search results could not be loaded.");
        setVisibleQuestions(filterWorkspaceQuestions(initialQuestions, selectedSyllabusId));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingResults(false);
      });

    return () => controller.abort();
  }, [initialQuestions, live, query, selectedSyllabusId, subjectKey]);

  const redirectToSignIn = useCallback(() => {
    const next = typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : baseHref;
    router.push(`/account?next=${encodeURIComponent(next)}`);
  }, [baseHref, router]);

  const ensureQuestionDetail = useCallback(async (questionId: string) => {
    if (detailsById.has(questionId)) return;
    setLoadingQuestions((current) => new Set(current).add(questionId));
    setQuestionErrors((current) => {
      const next = new Map(current);
      next.delete(questionId);
      return next;
    });

    try {
      const response = await fetch(`/api/workspace-questions/${encodeURIComponent(questionId)}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        redirectToSignIn();
        return;
      }
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Question details could not be loaded.");
      }
      setDetailsById((current) => {
        const next = new Map(current);
        next.set(questionId, payload as WorkspaceQuestion);
        return next;
      });
    } catch (error) {
      setQuestionErrors((current) => {
        const next = new Map(current);
        next.set(questionId, error instanceof Error ? error.message : "Question details could not be loaded.");
        return next;
      });
    } finally {
      setLoadingQuestions((current) => {
        const next = new Set(current);
        next.delete(questionId);
        return next;
      });
    }
  }, [detailsById, redirectToSignIn]);

  function toggleSet(current: Set<string>, id: string) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  function buildHref(nextQuery: string, nextSyllabusId: string) {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextSyllabusId) params.set("syllabus", nextSyllabusId);
    const suffix = params.toString();
    return suffix ? `${baseHref}?${suffix}` : baseHref;
  }

  function navigateTo(nextQuery: string, nextSyllabusId: string) {
    startTransition(() => router.push(buildHref(nextQuery, nextSyllabusId), { scroll: false }));
  }

  async function openPdf(answerId: string) {
    setLoadingAnswer(answerId);
    setViewerError(null);
    const tab = typeof window !== "undefined" ? window.open("", "_blank") : null;
    if (tab) tab.opener = null;
    try {
      const response = await fetch("/api/answer-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answerId }),
      });
      if (response.status === 401) {
        if (tab) tab.close();
        redirectToSignIn();
        return;
      }
      const payload = await response.json();
      const viewerUrl = payload?.viewerUrl || payload?.embedUrl;
      if (!response.ok || !viewerUrl) {
        throw new Error(payload?.error || "PDF could not be opened.");
      }
      if (tab) {
        tab.location.href = viewerUrl;
      } else {
        window.open(viewerUrl, "_blank", "noopener,noreferrer");
      }
      trackActivity(2);
    } catch (error) {
      if (tab) tab.close();
      setViewerError(error instanceof Error ? error.message : "PDF could not be opened.");
    } finally {
      setLoadingAnswer(null);
    }
  }

  const activeSyllabusLabel = selectedSyllabusId
    ? topicNodes.find((node) => node.id === selectedSyllabusId)?.label
    : null;
  const pending = isPending || isLoadingResults;

  return (
    <main className="library-page min-h-screen">
      <StudyNav />
      {pending && <div className="route-progress" aria-hidden="true" />}

      <section className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="overline mb-3">Subject workspace</div>
            <h1 className="text-3xl leading-tight tracking-[-0.02em] sm:text-4xl">{title}</h1>
            <p className="mt-3 max-w-3xl text-base leading-8 text-secondary">{description}</p>
            <p className="mt-3 text-sm text-muted">
              <span className="mono-stat text-secondary">{visibleQuestions.length.toLocaleString()}</span> questions
              {" · "}
              <span className="mono-stat text-secondary">{topperCount.toLocaleString()}</span> topper copies
              {activeSyllabusLabel ? <> · filtered to {activeSyllabusLabel}</> : null}
            </p>
          </div>
          <div className="w-full max-w-xs">
            <SubjectProgress questionIds={progressQuestionIds || initialQuestions.map((question) => makeProgressItemId("pyq", question.id))} label="Overall progress" />
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="soft-panel flex flex-col p-4 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-6rem)]">
            <div className="overline mb-3 shrink-0">Syllabus</div>
            <button
              type="button"
              className={selectedSyllabusId ? "nav-pill shrink-0" : "btn-primary w-full shrink-0 justify-start"}
              data-active={!selectedSyllabusId}
              onClick={() => navigateTo(query, "")}
            >
              All topics
            </button>

            <div className="nav-scroll mt-4 grid gap-4 overflow-y-auto pr-1">
              {groupNodes.map((group) => {
                const children = topicNodes.filter((node) => node.parentId === group.id);
                if (!children.length) return null;

                return (
                  <section key={group.id} className="grid gap-1">
                    <div
                      className="text-xs font-semibold uppercase tracking-[0.08em] transition-colors"
                      style={{ color: activeGroupId === group.id ? "var(--accent)" : "var(--fg-muted)" }}
                    >
                      {group.label}
                    </div>
                    {children.map((node) => {
                      const active = selectedSyllabusId === node.id;
                      return (
                        <button
                          key={node.id}
                          ref={active ? activeTopicRef : undefined}
                          type="button"
                          className="topic-row"
                          data-active={active}
                          onClick={() => navigateTo(query, node.id)}
                        >
                          <span className="leading-6">{node.label}</span>
                          <span className="mono-stat text-xs text-muted">{node.questionCount}</span>
                        </button>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          </aside>

          <div className="min-w-0">
            <form
              className="soft-panel p-3"
              onSubmit={(event) => {
                event.preventDefault();
                navigateTo(draftQuery, selectedSyllabusId);
              }}
            >
              <div className="relative">
                <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
                <input
                  name="q"
                  value={draftQuery}
                  onChange={(event) => setDraftQuery(event.target.value)}
                  placeholder={`Search inside ${title}`}
                  className="soft-input h-12 w-full pl-11 pr-4 text-sm"
                />
              </div>
              {(selectedSyllabusId || query.trim()) && (
                <div className="mt-3 flex flex-wrap items-center gap-2 px-1 text-sm text-secondary">
                  {query.trim() && <span className="study-badge">Search: {query.trim()}</span>}
                  {activeSyllabusLabel && <span className="study-badge study-badge-accent">{activeSyllabusLabel}</span>}
                  <button type="button" className="quiet-link px-2 text-xs font-semibold" onClick={() => navigateTo("", "")}>Clear</button>
                </div>
              )}
              <p className="workspace-disclaimer mt-3 px-1 text-xs text-muted">
                {authAvailable && !isAuthenticated
                  ? "PYQs stay public. Sign in to open topper copies, summaries, and PDFs."
                  : "Matches and summaries are OCR/AI-assisted study aids. Verify with the original PYQ and the source PDF."}
              </p>
            </form>

            {resultsError && <div className="soft-panel-muted mt-4 p-4 text-sm text-secondary">{resultsError}</div>}
            {viewerError && (
              <div className="soft-panel-muted mt-4 p-4 text-sm text-secondary">{viewerError}</div>
            )}

            <div className={`mt-5 grid gap-4${pending ? " is-pending" : ""}`} aria-busy={pending}>
              {visibleQuestions.map((question, index) => {
                const isOpen = openQuestions.has(question.id);
                const isLoading = loadingQuestions.has(question.id);
                const detail = detailsById.get(question.id) || question;
                const questionError = questionErrors.get(question.id) || null;
                return (
                  <article key={question.id} className="pyq-card overflow-hidden" data-done={isProgressDone(progressMap, "pyq", question.id)}>
                    <div className="grid gap-4 p-5 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:gap-5">
                      <div className="mono-stat hidden h-9 w-9 place-items-center rounded-full bg-[var(--accent-soft)] text-xs text-accent sm:grid">
                        {String(index + 1).padStart(2, "0")}
                      </div>

                      <div className="min-w-0">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="study-badge">{question.paper}</span>
                          {question.estimatedYear && <span className="study-badge">{question.estimatedYear}</span>}
                          {question.marks && <span className="study-badge">{question.marks} marks</span>}
                          <span className="study-badge study-badge-accent">
                            {question.topperCount} {question.topperCount === 1 ? "copy" : "copies"}
                          </span>
                        </div>
                        <h2 className="question-title text-lg leading-8 sm:text-xl">{question.question}</h2>
                        {question.syllabusPath[1] && (
                          <p className="mt-3 text-sm leading-7 text-secondary">{question.syllabusPath[1]}</p>
                        )}
                      </div>

                      <div className="flex flex-row items-center gap-2 sm:flex-col sm:items-end">
                        <ProgressToggle itemId={makeProgressItemId("pyq", question.id)} />
                        <button
                          type="button"
                          className={isOpen ? "btn-secondary" : "btn-primary"}
                          onClick={() => {
                            const opening = !isOpen;
                            setOpenQuestions((current) => toggleSet(current, question.id));
                            if (opening) {
                              void ensureQuestionDetail(question.id);
                            }
                            trackActivity();
                          }}
                        >
                          {isOpen ? "Hide copies" : "Topper copies"}
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="animate-fade-in border-t border-terminal p-5">
                        {isLoading && !detailsById.has(question.id) && (
                          <div className="soft-panel-muted flex items-center gap-3 p-4 text-sm text-secondary">
                            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                            Loading topper copies…
                          </div>
                        )}

                        {questionError && !isLoading && (
                          <div className="soft-panel-muted p-4 text-sm text-secondary">{questionError}</div>
                        )}

                        {!isLoading && !questionError && detail.linkedInsights.length > 0 && (
                          <div className="grid gap-3">
                            {detail.linkedInsights.map((copy) => {
                              const summaryOpen = openSummaries.has(copy.answerId);
                              const topperName = normalizePublicTopperName(copy.topperName) ?? "Topper copy";
                              return (
                                <article key={copy.answerId} className="soft-panel-muted copy-card p-4" data-done={isProgressDone(progressMap, "topper_copy", copy.answerId)}>
                                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                                    <div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-semibold">{topperName}</span>
                                        {copy.rank && <span className="study-badge">AIR {copy.rank}</span>}
                                        {copy.year && <span className="study-badge">{copy.year}</span>}
                                        {copy.institute && <span className="study-badge">{copy.institute}</span>}
                                        {copy.marks && <span className="study-badge">{copy.marks}</span>}
                                        {copy.pageHint && <span className="study-badge">Page {copy.pageHint}</span>}
                                      </div>
                                      {!copy.sourceAvailable && (
                                        <p className="mt-2 text-xs text-muted">
                                          {copy.sourceStatus === "not_uploaded"
                                            ? "Source PDF not uploaded yet."
                                            : copy.sourceStatus === "page_out_of_range"
                                              ? "Source page mapping needs correction."
                                              : "Source page not available yet."}
                                        </p>
                                      )}
                                    </div>

                                    <div className="flex flex-wrap gap-2 lg:justify-end">
                                      <ProgressToggle itemId={makeProgressItemId("topper_copy", copy.answerId)} />
                                      {copy.summaryAvailable && (
                                        <button
                                          type="button"
                                          className="btn-secondary"
                                          onClick={() => {
                                            setOpenSummaries((current) => toggleSet(current, copy.answerId));
                                            trackActivity();
                                          }}
                                        >
                                          <Sparkles size={15} aria-hidden="true" />
                                          {summaryOpen ? "Hide summary" : "Summary"}
                                        </button>
                                      )}
                                      {copy.sourceAvailable ? (
                                        <button
                                          type="button"
                                          className="btn-primary"
                                          onClick={() => void openPdf(copy.answerId)}
                                          disabled={loadingAnswer === copy.answerId}
                                        >
                                          {loadingAnswer === copy.answerId ? (
                                            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                                          ) : (
                                            <ExternalLink size={15} aria-hidden="true" />
                                          )}
                                          View PDF
                                        </button>
                                      ) : (
                                        <span className="study-badge">PDF unavailable</span>
                                      )}
                                    </div>
                                  </div>

                                  {summaryOpen && copy.summaryAvailable && (
                                    <>
                                      <div className="summary-box mt-4 p-4 text-sm leading-7 text-secondary">
                                        {copy.summary}
                                      </div>
                                      <p className="mt-3 text-xs text-muted">
                                        Summary is OCR/AI-assisted. Verify with the original PDF page before relying on it.
                                      </p>
                                    </>
                                  )}
                                </article>
                              );
                            })}
                          </div>
                        )}

                        {!isLoading && !questionError && detail.linkedInsights.length === 0 && (
                          <div className="soft-panel-muted p-4 text-sm leading-7 text-secondary">
                            No topper copies are attached to this question yet.
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            {visibleQuestions.length === 0 && (
              <div className="soft-panel-muted mt-5 px-6 py-20 text-center text-secondary">
                No questions matched this topic and search.
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function filterWorkspaceQuestions(questions: WorkspaceQuestion[], syllabusNodeId: string) {
  if (!syllabusNodeId) return questions;
  return questions.filter((question) => question.syllabusNodeId === syllabusNodeId);
}

function isProgressDone(progressMap: Record<string, { done?: boolean }>, type: ProgressItemType, id: string) {
  return progressItemCandidates(type, id).some((candidate) => Boolean(progressMap[candidate]?.done));
}

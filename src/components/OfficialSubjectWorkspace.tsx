"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Search, Sparkles } from "lucide-react";
import { useUserData } from "@/components/auth/UserDataProvider";
import { StudyNav } from "@/components/StudyNav";
import { ProgressToggle } from "./ProgressToggle";
import { SubjectProgress } from "./SubjectProgress";
import type { SubjectPyqCard, TopperCopy } from "@/lib/search-results";
import type { WorkspaceSyllabusNode } from "@/lib/question-bank-runtime";
import { normalizePublicTopperName } from "@/lib/public-records";
import { makeProgressItemId, progressItemCandidates, type ProgressItemType } from "@/lib/progress-items";
import type { SubjectKey } from "@/lib/subject-definitions";

interface OfficialSubjectWorkspaceProps {
  subjectKey: SubjectKey;
  title: string;
  description: string;
  questions: SubjectPyqCard[];
  syllabusNodes: WorkspaceSyllabusNode[];
  query?: string;
  selectedSyllabusId?: string;
  focusedQuestionId?: string;
  progressQuestionIds?: string[];
  baseHref: string;
  isLoadingResults?: boolean;
  resultNotice?: string | null;
  queryError?: string | null;
  focusedQuestionMissing?: boolean;
}

const OPTIONAL_SUBJECTS = new Set<SubjectKey>([
  "anthropology",
  "geography",
  "history",
  "psir",
  "public-administration",
  "sociology",
]);

export function OfficialSubjectWorkspace({
  subjectKey,
  title,
  description,
  questions,
  syllabusNodes,
  query = "",
  selectedSyllabusId = "",
  focusedQuestionId = "",
  progressQuestionIds,
  baseHref,
  isLoadingResults = false,
  resultNotice = null,
  queryError = null,
  focusedQuestionMissing = false,
}: OfficialSubjectWorkspaceProps) {
  const router = useRouter();
  const { authAvailable, isAuthenticated, progressMap, trackActivity } = useUserData();
  const [isPending, startTransition] = useTransition();
  const [openPyqs, setOpenPyqs] = useState<Set<string>>(() => focusedQuestionId ? new Set([focusedQuestionId]) : new Set());
  const [detailsById, setDetailsById] = useState<Map<string, SubjectPyqCard>>(new Map());
  const [loadingQuestions, setLoadingQuestions] = useState<Set<string>>(new Set());
  const [questionErrors, setQuestionErrors] = useState<Map<string, string>>(new Map());
  const [openSummaries, setOpenSummaries] = useState<Set<string>>(new Set());
  const [loadingAnswer, setLoadingAnswer] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const activeTopicRef = useRef<HTMLButtonElement | null>(null);
  const focusedHandledRef = useRef<string>("");

  const groupNodes = useMemo(() => syllabusNodes.filter((node) => node.kind === "group"), [syllabusNodes]);
  const topicNodes = useMemo(() => syllabusNodes.filter((node) => node.kind === "topic"), [syllabusNodes]);
  const linkedCopyCount = useMemo(() => questions.reduce((sum, question) => sum + question.topperCount, 0), [questions]);
  const orderedQuestions = useMemo(() => reorderQuestions(questions, focusedQuestionId), [focusedQuestionId, questions]);
  const activeGroupId = useMemo(() => {
    if (!selectedSyllabusId) return null;
    return topicNodes.find((node) => node.id === selectedSyllabusId)?.parentId ?? null;
  }, [selectedSyllabusId, topicNodes]);
  const activeSyllabusLabel = selectedSyllabusId
    ? topicNodes.find((node) => node.id === selectedSyllabusId)?.label
    : null;

  useEffect(() => {
    activeTopicRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedSyllabusId]);

  const scrollQuestionIntoView = useCallback((questionId: string) => {
    const element = document.getElementById(cardElementId(questionId));
    if (!element) return;
    element.scrollIntoView({ block: "start", behavior: "smooth" });
    if (element instanceof HTMLElement) element.focus({ preventScroll: true });
  }, []);

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
      const response = await fetch(`/api/official-questions/${encodeURIComponent(questionId)}`, {
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
        next.set(questionId, payload as SubjectPyqCard);
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

  useEffect(() => {
    if (!focusedQuestionId) return;
    if (focusedHandledRef.current === focusedQuestionId) return;
    focusedHandledRef.current = focusedQuestionId;
    setOpenPyqs((current) => new Set(current).add(focusedQuestionId));
    void ensureQuestionDetail(focusedQuestionId);
    const timers = [0, 180, 640].map((delay) => window.setTimeout(() => {
      scrollQuestionIntoView(focusedQuestionId);
    }, delay));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [ensureQuestionDetail, focusedQuestionId, scrollQuestionIntoView]);

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
      if (tab) tab.location.href = viewerUrl;
      else window.open(viewerUrl, "_blank", "noopener,noreferrer");
      trackActivity(2);
    } catch (error) {
      if (tab) tab.close();
      setViewerError(error instanceof Error ? error.message : "PDF could not be opened.");
    } finally {
      setLoadingAnswer(null);
    }
  }

  return (
    <main className="library-page min-h-screen">
      <StudyNav />
      {isPending && <div className="route-progress" aria-hidden="true" />}

      <section className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="overline mb-3">PYQ workspace</div>
            <h1 className="text-3xl leading-tight tracking-[-0.02em] sm:text-4xl">{title}</h1>
            <p className="mt-3 max-w-3xl text-base leading-8 text-secondary">{description}</p>
            <p className="mt-3 text-sm text-muted">
              <span className="mono-stat text-secondary">{questions.length.toLocaleString()}</span> PYQs
              {" · "}
              <span className="mono-stat text-secondary">{linkedCopyCount.toLocaleString()}</span> linked topper copies
              {activeSyllabusLabel ? <> · filtered to {activeSyllabusLabel}</> : null}
            </p>
            {OPTIONAL_SUBJECTS.has(subjectKey) && (
              <p className="workspace-disclaimer mt-4 max-w-3xl text-sm leading-7 text-secondary">
                Some optional PYQs are best-available extracted rows linked to topper copies. Authoritative optional source migration is in progress.
              </p>
            )}
          </div>
          <div className="w-full max-w-xs">
            <SubjectProgress questionIds={progressQuestionIds || questions.map((question) => makeProgressItemId("pyq", question.id))} label="Overall progress" />
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
                const form = new FormData(event.currentTarget);
                navigateTo(String(form.get("q") || ""), selectedSyllabusId);
              }}
            >
              <div className="relative">
                <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
                <input
                  aria-label={`Search official PYQs in ${title}`}
                  name="q"
                  defaultValue={query}
                  placeholder={`Search official PYQs in ${title}`}
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

            {viewerError && <div className="soft-panel-muted mt-4 p-4 text-sm text-secondary" role="alert">{viewerError}</div>}

            {isLoadingResults && (
              <div className="soft-panel-muted mt-4 p-4 text-sm text-secondary" role="status" aria-live="polite">
                Searching PYQs…
              </div>
            )}

            {resultNotice && !isLoadingResults && (
              <div className="soft-panel-muted mt-4 p-4 text-sm text-secondary" role="status" aria-live="polite">
                {resultNotice}
              </div>
            )}

            {queryError && !isLoadingResults && (
              <div className="soft-panel-muted mt-4 p-4 text-sm text-secondary" role="alert">
                {queryError}
              </div>
            )}

            {focusedQuestionMissing && !isLoadingResults && (
              <div className="soft-panel-muted mt-4 p-4 text-sm text-secondary" role="alert">
                Linked PYQ could not be found.
              </div>
            )}

            <div className={`mt-5 grid gap-4${isPending ? " is-pending" : ""}`} aria-busy={isPending}>
              {orderedQuestions.map((question, index) => {
                const isOpen = openPyqs.has(question.id);
                const isLoading = loadingQuestions.has(question.id);
                const detail = detailsById.get(question.id) || question;
                const questionError = questionErrors.get(question.id) || null;
                const pyqProgressId = makeProgressItemId("pyq", question.id);
                const panelId = matchesPanelId(question.id);
                return (
                  <article
                    key={question.id}
                    id={cardElementId(question.id)}
                    className="pyq-card overflow-hidden"
                    data-done={isProgressDone(progressMap, "pyq", question.id)}
                    tabIndex={focusedQuestionId === question.id ? -1 : undefined}
                  >
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
                            {question.relevantQuestionCount} relevant {question.relevantQuestionCount === 1 ? "answer" : "answers"}
                          </span>
                          <span className="study-badge">
                            {question.topperCount} {question.topperCount === 1 ? "copy" : "copies"}
                          </span>
                        </div>
                        <h2 className="question-title text-lg leading-8 sm:text-xl">{question.question}</h2>
                        {question.syllabusTags[0] && (
                          <p className="mt-3 text-sm leading-7 text-secondary">{question.syllabusTags[0]}</p>
                        )}
                      </div>

                      <div className="flex flex-row items-center gap-2 sm:flex-col sm:items-end">
                        <ProgressToggle itemId={pyqProgressId} />
                        <button
                          type="button"
                          className={isOpen ? "btn-secondary" : "btn-primary"}
                          aria-expanded={isOpen}
                          aria-controls={panelId}
                          onClick={() => {
                            const opening = !isOpen;
                            setOpenPyqs((current) => toggleSet(current, question.id));
                            if (opening) {
                              void ensureQuestionDetail(question.id);
                            }
                            trackActivity();
                          }}
                        >
                          {isOpen ? "Hide matches" : "Relevant copies"}
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div id={panelId} className="animate-fade-in border-t border-terminal p-5">
                        {isLoading && !detailsById.has(question.id) && (
                          <div className="soft-panel-muted flex items-center gap-3 p-4 text-sm text-secondary" role="status" aria-live="polite">
                            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                            Loading relevant copies…
                          </div>
                        )}

                        {questionError && !isLoading && (
                          <div className="soft-panel-muted p-4 text-sm text-secondary" role="alert">{questionError}</div>
                        )}

                        {!isLoading && !questionError && detail.relevantQuestions.length > 0 && (
                          <div className="grid gap-4">
                            {detail.relevantQuestions.map((relevant, relevantIndex) => {
                              const isPossibleRelated = relevant.matchType === "loose-topic-match" && relevant.matchConfidence < 0.5;
                              return (
                                <article key={relevant.id} className="soft-panel-muted relevant-card p-4" data-done={isProgressDone(progressMap, "relevant_question", relevant.id)}>
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="overline">{isPossibleRelated ? "Possible related answer" : "Relevant topper answer"} {relevantIndex + 1}</span>
                                    <span className="study-badge">{Math.round(relevant.matchConfidence * 100)}% match</span>
                                    {isPossibleRelated && <span className="study-badge">Needs review</span>}
                                    {relevant.sourceAvailableCount > 0 && <span className="study-badge study-badge-accent">{relevant.sourceAvailableCount} PDFs</span>}
                                  </div>
                                  <ProgressToggle itemId={makeProgressItemId("relevant_question", relevant.id)} />
                                </div>
                                <p className="text-base leading-7 text-primary">{relevant.question}</p>
                                <p className="mt-2 text-xs leading-5 text-muted">{relevant.matchReason}</p>

                                <div className="mt-4 grid gap-3">
                                  {relevant.topperCopies.map((copy) => (
                                    <TopperCopyCard
                                      key={copy.answerId}
                                      copy={copy}
                                      loading={loadingAnswer === copy.answerId}
                                      summaryOpen={openSummaries.has(copy.answerId)}
                                      progressDone={isProgressDone(progressMap, "topper_copy", copy.answerId)}
                                      onToggleSummary={() => {
                                        setOpenSummaries((current) => toggleSet(current, copy.answerId));
                                        trackActivity();
                                      }}
                                      onOpenPdf={() => void openPdf(copy.answerId)}
                                    />
                                  ))}
                                </div>
                                </article>
                              );
                            })}
                          </div>
                        )}

                        {!isLoading && !questionError && detail.relevantQuestions.length === 0 && (
                          <div className="soft-panel-muted p-4 text-sm leading-7 text-secondary">
                            No relevant topper copies are attached to this PYQ yet.
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            {!isLoadingResults && questions.length === 0 && (
              <div className="soft-panel-muted mt-5 px-6 py-20 text-center text-secondary">
                {focusedQuestionMissing ? "Linked PYQ could not be found." : "No official PYQs matched this topic and search."}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function TopperCopyCard({
  copy,
  loading,
  progressDone,
  summaryOpen,
  onToggleSummary,
  onOpenPdf,
}: {
  copy: TopperCopy;
  loading: boolean;
  progressDone: boolean;
  summaryOpen: boolean;
  onToggleSummary: () => void;
  onOpenPdf: () => void;
}) {
  const topperName = normalizePublicTopperName(copy.topperName) ?? "Topper copy";
  const summaryAvailable = Boolean(copy.interpretation && copy.summaryStatus === "available");

  return (
    <article className="copy-card rounded-xl border border-terminal bg-[var(--bg-surface)] p-4" data-done={progressDone}>
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
          {!copy.sourceAvailable && <p className="mt-2 text-xs text-muted">Source PDF is not available yet.</p>}
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <ProgressToggle itemId={makeProgressItemId("topper_copy", copy.answerId)} />
          {summaryAvailable && (
            <button
              type="button"
              className="btn-secondary"
              aria-expanded={summaryOpen}
              aria-controls={summaryPanelId(copy.answerId)}
              onClick={onToggleSummary}
            >
              <Sparkles size={15} aria-hidden="true" />
              {summaryOpen ? "Hide summary" : "Summary"}
            </button>
          )}
          {copy.sourceAvailable ? (
            <button type="button" className="btn-primary" onClick={onOpenPdf} disabled={loading}>
              {loading ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ExternalLink size={15} aria-hidden="true" />}
              View PDF
            </button>
          ) : (
            <span className="study-badge">PDF unavailable</span>
          )}
        </div>
      </div>

      {summaryOpen && summaryAvailable && (
        <>
          <div id={summaryPanelId(copy.answerId)} className="summary-box mt-4 p-4 text-sm leading-7 text-secondary">{copy.interpretation}</div>
          <p className="mt-3 text-xs text-muted">
            Summary is OCR/AI-assisted. Verify with the original PDF page before relying on it.
          </p>
        </>
      )}
    </article>
  );
}

function cardElementId(id: string) {
  return `pyq-${id.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
}

function matchesPanelId(id: string) {
  return `pyq-matches-${id.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
}

function summaryPanelId(id: string) {
  return `copy-summary-${id.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
}

function isProgressDone(progressMap: Record<string, { done?: boolean }>, type: ProgressItemType, id: string) {
  return progressItemCandidates(type, id).some((candidate) => Boolean(progressMap[candidate]?.done));
}

function reorderQuestions(questions: SubjectPyqCard[], focusedQuestionId: string) {
  if (!focusedQuestionId) return questions;
  const target = questions.find((question) => question.id === focusedQuestionId);
  if (!target) return questions;
  return [target, ...questions.filter((question) => question.id !== focusedQuestionId)];
}

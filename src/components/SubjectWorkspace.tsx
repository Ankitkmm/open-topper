"use client";

import { startTransition, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Loader2, Search, Sparkles } from "lucide-react";
import { AuthControls } from "@/components/auth/AuthControls";
import { useUserData } from "@/components/auth/UserDataProvider";
import { ThemeSwitcher } from "./ThemeProvider";
import { ProgressToggle } from "./ProgressToggle";
import { SubjectProgress } from "./SubjectProgress";
import { PdfViewer } from "./PdfViewer";
import { getSubjectDefinitions, type SubjectKey } from "@/lib/subject-definitions";
import type { WorkspaceQuestion, WorkspaceSyllabusNode } from "@/lib/question-bank";
import { displayPublicTopperName } from "@/lib/public-records";

interface SubjectWorkspaceProps {
  subjectKey: SubjectKey;
  title: string;
  description: string;
  questions: WorkspaceQuestion[];
  syllabusNodes: WorkspaceSyllabusNode[];
  query?: string;
  selectedSyllabusId?: string;
  baseHref: string;
}

interface ViewerState {
  src: string;
  title: string;
  page: number;
  pageStatus?: "valid" | "missing" | "fallback" | "out_of_range" | null;
}

export function SubjectWorkspace({
  subjectKey,
  title,
  description,
  questions,
  syllabusNodes,
  query = "",
  selectedSyllabusId = "",
  baseHref,
}: SubjectWorkspaceProps) {
  const router = useRouter();
  const { trackActivity } = useUserData();
  const [openQuestions, setOpenQuestions] = useState<Set<string>>(new Set());
  const [openSummaries, setOpenSummaries] = useState<Set<string>>(new Set());
  const [loadingAnswer, setLoadingAnswer] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  const groupNodes = useMemo(
    () => syllabusNodes.filter((node) => node.kind === "group"),
    [syllabusNodes],
  );
  const topicNodes = useMemo(
    () => syllabusNodes.filter((node) => node.kind === "topic"),
    [syllabusNodes],
  );
  const topicCounts = useMemo(
    () => questions.reduce((sum, question) => sum + question.linkedInsights.length, 0),
    [questions],
  );

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
    const href = buildHref(nextQuery, nextSyllabusId);
    startTransition(() => router.push(href));
  }

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  }

  async function openPdf(answerId: string, titleText: string) {
    setLoadingAnswer(answerId);
    setViewerError(null);
    try {
      const response = await fetch("/api/answer-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answerId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.embedUrl) {
        throw new Error(payload?.error || "PDF could not be opened.");
      }
      setViewer({
        src: payload.embedUrl,
        title: titleText,
        page: payload.page || 1,
        pageStatus: payload.pageStatus || null,
      });
      trackActivity(2);
    } catch (error) {
      setViewerError(error instanceof Error ? error.message : "PDF could not be opened.");
    } finally {
      setLoadingAnswer(null);
    }
  }

  return (
    <main className="library-page min-h-screen">
      <section className="mx-auto max-w-7xl px-5 py-5 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-terminal pb-5">
          <button type="button" className="quiet-link inline-flex items-center gap-2 text-sm font-semibold" onClick={handleBack}>
            <ArrowLeft size={16} aria-hidden="true" />
            Back
          </button>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Subjects">
            {getSubjectDefinitions().map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={item.key === subjectKey ? "btn-primary" : "btn-secondary"}
              >
                {item.shortLabel}
              </Link>
            ))}
            <Link href="/browse" className="btn-secondary">
              <Search size={15} aria-hidden="true" />
              Search all
            </Link>
            <ThemeSwitcher compact />
            <AuthControls compact />
          </nav>
        </header>

        <section className="grid gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
          <div>
            <div className="overline mb-3">Subject workspace</div>
            <h1 className="text-4xl font-semibold leading-tight sm:text-6xl">{title}</h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-secondary">{description}</p>
          </div>
          <SubjectProgress questionIds={questions.map((question) => question.id)} />
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Visible PYQs" value={questions.length.toLocaleString()} />
          <Metric label="Topper copies" value={topicCounts.toLocaleString()} />
          <Metric label="Selected node" value={selectedSyllabusId ? "1" : "All"} />
          <Metric label="Mode" value="Syllabus first" />
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="soft-panel h-fit p-4 lg:sticky lg:top-4">
            <div className="overline mb-3">Syllabus</div>
            <button
              type="button"
              className={selectedSyllabusId ? "quiet-link text-sm" : "btn-primary w-full justify-start"}
              onClick={() => navigateTo(query, "")}
            >
              All syllabus nodes
            </button>

            <div className="mt-4 grid gap-4">
              {groupNodes.map((group) => {
                const children = topicNodes.filter((node) => node.parentId === group.id);
                if (!children.length) return null;

                return (
                  <section key={group.id} className="grid gap-1">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                      {group.label}
                    </div>
                    {children.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        className={
                          selectedSyllabusId === node.id
                            ? "soft-button w-full justify-between text-left"
                            : "flex w-full items-start justify-between rounded-2xl border border-terminal px-3 py-2 text-left text-sm text-secondary transition hover:border-[var(--accent)] hover:text-primary"
                        }
                        data-variant={selectedSyllabusId === node.id ? "primary" : "secondary"}
                        onClick={() => navigateTo(query, node.id)}
                      >
                        <span className="pr-3 leading-6">{node.label}</span>
                        <span className="mono-stat text-xs text-muted">{node.questionCount}</span>
                      </button>
                    ))}
                  </section>
                );
              })}
            </div>
          </aside>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
            <div className="min-w-0">
              <form
                className="soft-panel p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  navigateTo(String(form.get("q") || ""), selectedSyllabusId);
                }}
              >
                <div className="relative">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
                  <input
                    name="q"
                    defaultValue={query}
                    placeholder={`Search inside ${title}`}
                    className="soft-input h-12 w-full pl-11 pr-4 text-sm"
                  />
                </div>
                {(selectedSyllabusId || query.trim()) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-secondary">
                    {query.trim() && <span className="study-badge">Search: {query.trim()}</span>}
                    {selectedSyllabusId && (
                      <span className="study-badge study-badge-accent">
                        {topicNodes.find((node) => node.id === selectedSyllabusId)?.label || "Selected syllabus"}
                      </span>
                    )}
                    <button type="button" className="quiet-link text-xs font-semibold" onClick={() => navigateTo("", "")}>
                      Clear filters
                    </button>
                  </div>
                )}
              </form>

              {viewerError && (
                <div className="mt-4 soft-panel-muted p-4 text-sm text-secondary">
                  {viewerError}
                </div>
              )}

              <section className="mt-6 grid gap-5">
                {questions.map((question, index) => {
                  const isOpen = openQuestions.has(question.id);
                  return (
                    <article key={question.id} className="pyq-card overflow-hidden">
                      <div className="grid gap-4 p-4 sm:grid-cols-[48px_minmax(0,1fr)_auto] sm:p-5">
                        <div className="mono-stat hidden h-11 w-11 place-items-center rounded-full bg-[var(--accent-soft)] text-xs text-accent sm:grid">
                          {String(index + 1).padStart(2, "0")}
                        </div>

                        <div className="min-w-0">
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span className="study-badge">{question.paper}</span>
                            {question.estimatedYear && <span className="study-badge">{question.estimatedYear}</span>}
                            {question.marks && <span className="study-badge">{question.marks} marks</span>}
                            <span className="study-badge study-badge-accent">
                              {question.linkedInsights.length} {question.linkedInsights.length === 1 ? "copy" : "copies"}
                            </span>
                          </div>
                          <h2 className="question-title text-lg font-semibold leading-8 sm:text-xl">
                            {question.question}
                          </h2>
                          {question.syllabusPath[1] && (
                            <p className="mt-3 text-sm leading-7 text-secondary">{question.syllabusPath[1]}</p>
                          )}
                        </div>

                        <div className="flex flex-col items-start gap-2 sm:items-end">
                          <ProgressToggle questionId={question.id} />
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => {
                              setOpenQuestions((current) => toggleSet(current, question.id));
                              trackActivity();
                            }}
                          >
                            {isOpen ? "Hide copies" : "Topper copies"}
                          </button>
                        </div>
                      </div>

                      {isOpen && (
                        <div className="animate-fade-in border-t border-terminal p-4 sm:p-5">
                          <div className="grid gap-3">
                            {question.linkedInsights.length > 0 ? (
                              question.linkedInsights.map((copy) => {
                                const summaryOpen = openSummaries.has(copy.answerId);
                                const topperLabel = displayPublicTopperName(copy.topperName);
                                return (
                                  <article key={copy.answerId} className="soft-panel p-4">
                                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                                      <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="font-semibold">{topperLabel}</span>
                                          {copy.rank && <span className="study-badge">AIR {copy.rank}</span>}
                                          {copy.year && <span className="study-badge">{copy.year}</span>}
                                          {copy.institute && <span className="study-badge">{copy.institute}</span>}
                                          {copy.marks && <span className="study-badge">{copy.marks}</span>}
                                          {copy.pageHint && <span className="study-badge">Page {copy.pageHint}</span>}
                                        </div>
                                        <p className="mt-2 text-xs leading-6 text-muted">{question.question}</p>
                                        {!copy.sourceAvailable && (
                                          <p className="mt-2 text-xs text-muted">
                                            {copy.sourceStatus === "not_uploaded"
                                              ? "PDF not uploaded yet."
                                              : copy.sourceStatus === "page_out_of_range"
                                                ? "PDF page mapping needs correction."
                                                : "PDF page not available yet."}
                                          </p>
                                        )}
                                      </div>

                                      <div className="flex flex-wrap gap-2 lg:justify-end">
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
                                            {summaryOpen ? "Hide summary" : "Show summary"}
                                          </button>
                                        )}
                                        {copy.sourceAvailable ? (
                                          <button
                                            type="button"
                                            className="btn-primary"
                                            onClick={() => void openPdf(copy.answerId, `${topperLabel} · ${question.question}`)}
                                            disabled={loadingAnswer === copy.answerId}
                                          >
                                            {loadingAnswer === copy.answerId ? (
                                              <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                                            ) : (
                                              <FileText size={15} aria-hidden="true" />
                                            )}
                                            View PDF
                                          </button>
                                        ) : (
                                          <span className="study-badge">PDF unavailable</span>
                                        )}
                                      </div>
                                    </div>

                                    {summaryOpen && copy.summaryAvailable && (
                                      <div className="summary-box mt-4 p-4 text-sm leading-7 text-secondary">
                                        {copy.summary}
                                      </div>
                                    )}
                                  </article>
                                );
                              })
                            ) : (
                              <div className="soft-panel-muted p-4 text-sm leading-7 text-secondary">
                                No topper copies are attached to this PYQ yet.
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>

              {questions.length === 0 && (
                <div className="py-20 text-center text-secondary">
                  No PYQs matched this syllabus node and search query.
                </div>
              )}
            </div>

            <aside className="soft-panel overflow-hidden p-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
              {viewer ? (
                <div className="flex min-h-[520px] flex-col">
                  <div className="border-b border-terminal px-4 py-3 text-xs text-secondary">
                    Inline PDF viewer
                  </div>
                  <div className="min-h-0 flex-1">
                    <PdfViewer
                      src={viewer.src}
                      initialPage={viewer.page}
                      title={viewer.title}
                      pageStatus={viewer.pageStatus}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[520px] flex-col items-center justify-center gap-3 px-6 py-8 text-center">
                  <FileText size={28} className="text-muted" aria-hidden="true" />
                  <div className="text-sm font-semibold text-primary">Select a topper copy PDF</div>
                  <p className="max-w-xs text-sm leading-6 text-secondary">
                    Choose any available `View PDF` action on the left to open the mapped page here with pdf.js.
                  </p>
                </div>
              )}
            </aside>
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="soft-panel p-4">
      <div className="overline">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-accent">{value}</div>
    </div>
  );
}
